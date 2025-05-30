import type { Highs } from "highs";

export type InputRecord = {
  hourStart: Date
  consumptionKWh: number
  importPrice: number
  exportPrice: number
  // output in kW of a 1kW nominal PV panel
  pvProductionKWNormalized: number
}

export type DayResults = {
  day: DayChunk;
  timestamps: Date[];
  batteryKWh: number[];
  importPrice: number[];
  exportPrice: number[];
  pvOutputKW: number[];
  uncontrolledLoad: number[];
  // Where does the battery end up at the end of the 24-hour period?
  batteryKWhAtEoD: number,
  spec: {
    problem: string;
    batteryKW: number;
    batteryKWh: number;
  }
};

export type SystemSpec = {
  batteryKW: number
  batteryKWh: number
  // What is the battery state at the beginning of this day?
  batteryKWhAtSoD: number
  pvKW: number
}

export function analyzeOne(highs: Highs, spec: SystemSpec, day: DayChunk) : DayResults {
  let currentChargeKWh = spec.batteryKWhAtSoD;

  const hours = Math.min(48, day.records.length);

  let objectives = [];
  let constraints = [];
  let bounds = [];

  for(let h=0;h<hours;h++) {
    const spotPrice = day.records[h].importPrice;
    const gridFee = 0.20 + 0.0561 * spotPrice;
    const energyTax = 0.535;
    objectives.push(`${spotPrice + gridFee + energyTax} h${h}_bat_kw`)

    // In each hour we can charge +/- the inverter kW, notwithstanding state-of-charge
    bounds.push(`-${spec.batteryKW} <= h${h}_bat_kw <= ${spec.batteryKW}`);

    if(h === 0) {
      // First hour must be exactly the initial state-of-charge
      constraints.push(`soc_h${h} = ${currentChargeKWh}`);
    } else {
      // Subsequent hours state-of-charge is bound by the battery capacity
      bounds.push(`0 <= soc_h${h} <= ${spec.batteryKWh}`);
      // The current hours state-of-charge is equal to the prior hours soc + energy charged
      constraints.push(`soc_h${h - 1} - h${h}_bat_kw - soc_h${h} = 0`);
    }
  }
  const problem = `Maximize
        obj:
          ${objectives.join(" + ")}
        Subject To
          ${constraints.join("\n            ")}
        Bounds
          ${bounds.join("\n            ")}
        End`;
  const sol = highs.solve(problem);

  const result: DayResults = {
    day,
    timestamps: [],
    importPrice: [],
    exportPrice: [],
    pvOutputKW: [],
    batteryKWh: [],
    uncontrolledLoad: [],
    batteryKWhAtEoD: (sol.Columns[`soc_h23`] as any)['Primal'],
    spec: {
      batteryKW:spec.batteryKW, batteryKWh: spec.batteryKWh, problem
    }
  }
  for(let h=0;h<24;h++) {
    result.timestamps.push(day.records[h].hourStart);
    result.importPrice.push(day.records[h].importPrice);
    result.exportPrice.push(day.records[h].exportPrice);
    result.uncontrolledLoad.push(day.records[h].consumptionKWh);
    if(day.records[h].hourStart.getUTCFullYear() == 2025 && day.records[h].hourStart.getUTCMonth() == 2 && day.records[h].hourStart.getUTCDate() == 27) {
      console.log("WHAT", day.records[h].hourStart, day.records[h].pvProductionKWNormalized, spec.pvKW, day.records[h].pvProductionKWNormalized * spec.pvKW)
    }
    result.pvOutputKW.push(day.records[h].pvProductionKWNormalized * spec.pvKW);
    result.batteryKWh.push((sol.Columns[`soc_h${h}`] as any)['Primal']);
  }
  return result;
}

export function preprocess(pvwatts: PVWattsDataset, tibberdata: TibberDataset) : InputRecord[] {
  let out:InputRecord[] = [];

  for(let tr of tibberdata) {
    let hourStart = new Date(tr.from);
    let yearStartUTC = new Date(Date.UTC(hourStart.getUTCFullYear()));
    let millisSinceStartOfUTCYear = hourStart.getTime() - yearStartUTC.getTime();
    let hoursIntoUtcYear = Math.floor(millisSinceStartOfUTCYear / 1000 / 60 / 60);
    if(hourStart.getUTCFullYear() == 2025 && hourStart.getUTCMonth() == 2 && hourStart.getUTCDate() == 27) {
      console.log(hourStart, hoursIntoUtcYear, pvwatts.outputs.ac[hoursIntoUtcYear] / 1000.0)
    }
    out.push({
      hourStart,
      consumptionKWh: tr.consumption,
      importPrice: tr.unitPrice + tr.unitPriceVAT,
      exportPrice: tr.unitPrice + tr.unitPriceVAT,
      pvProductionKWNormalized: pvwatts.outputs.ac[hoursIntoUtcYear] / 1000.0,
    })
  }

  return out;
}

export function toDayChunks(records: InputRecord[]) : DayChunk[] {
  const toUtcDay = (dt: Date) : Date => new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
  let out: DayChunk[] = [];

  const startDayOffset = records.findIndex(r => r.hourStart.getUTCHours() == 0);
  const startDay = toUtcDay(records[startDayOffset].hourStart);
  const endDay = toUtcDay(records[records.length - 48].hourStart);

  let currentDay = startDay;
  while(currentDay.getTime() < endDay.getTime()) {
    let currentDayStartOffset = records.findIndex(r => r.hourStart.getTime() == currentDay.getTime());
    out.push({
      day: currentDay,
      dayName: currentDay.toISOString().split("T")[0],
      records: records.slice(currentDayStartOffset, currentDayStartOffset + 48),
    });
    currentDay = new Date(currentDay);
    currentDay.setUTCDate(currentDay.getUTCDate() + 1);
  }
  return out;
}

export type DayChunk = {
  day: Date
  dayName: string
  // horizon to analyze for this day; this would be like 48h or longer if we want a more precise analysis
  records: InputRecord[]
}

export type PVWattsDataset = {
  errors: any[]
  warnings: any[]
  outputs: {
    // Hourly ac output, 1 year
    ac: number[]
    // There are multiple other column-oriented series here
  }
  station_info: {
    city: string
    tz: number // utc offset
    lat: number
    lon: number
    distance: number
    // there are more fields here
  }
}

export type TibberRecord = {
  consumption: number
  cost: number
  from: string
  // Price, excl VAT
  unitPrice: number
  // VAT portion of price
  unitPriceVAT: number
  currency: string
}

export type TibberDataset = TibberRecord[]