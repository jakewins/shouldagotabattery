import type { Highs, HighsSolution } from "highs";

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
  importKW: number[];
  exportKW: number[];
  pvOutputKW: number[];
  uncontrolledLoad: number[];
  // Where does the battery end up at the end of the 24-hour period?
  batteryKWhAtEoD: number,
  spec: {
    problem: string;
    batteryKW: number;
    batteryKWh: number;
  },
  solution: HighsSolution
};

export type SystemSpec = {
  batteryKW: number
  batteryKWh: number
  // What is the battery state at the beginning of this day?
  batteryKWhAtSoD: number
  pvKW: number
  maxExportKW: number
  maxImportKW: number
}

export function analyzeOne(highs: Highs, spec: SystemSpec, day: DayChunk) : DayResults {
  let currentChargeKWh = spec.batteryKWhAtSoD;

  const hours = Math.min(48, day.records.length);

  let objectives = [];
  let constraints = [];
  let bounds = [];

  for(let h=0;h<hours;h++) {
    // Throughout, positives indicate output / production, negatives indicate consumption
    objectives.push(`${day.records[h].importPrice} import_h${h}`)
    objectives.push(`-${day.records[h].exportPrice} export_h${h}`)

    // Balance-of-energy constraint - everything must add up to zero
    constraints.push(`import_h${h} - export_h${h} + bat_kw_h${h} + unc_ld_h${h} + pv_h${h} = 0`);

    // Import & Export; same variable split in two because cost is different
    bounds.push(`0 <= import_h${h} <= ${spec.maxImportKW}`);
    bounds.push(`0 <= export_h${h} <= ${spec.maxExportKW}`);

    // Uncontrolled load
    bounds.push(`-${day.records[h].consumptionKWh} <= unc_ld_h${h} <= -${day.records[h].consumptionKWh}`);
    // PV output - allowing curtailment down to zero
    bounds.push(`0 <= pv_h${h} <= ${day.records[h].pvProductionKWNormalized * spec.pvKW}`);

    // Battery
    // In each hour we can charge +/- the inverter kW, notwithstanding state-of-charge
    bounds.push(`-${spec.batteryKW} <= bat_kw_h${h} <= ${spec.batteryKW}`);

    if(h === 0) {
      // First hour must be exactly the initial state-of-charge
      constraints.push(`soc_h${h} = ${currentChargeKWh}`);
    } else {
      // Subsequent hours state-of-charge is bound by the battery capacity
      bounds.push(`0 <= soc_h${h} <= ${spec.batteryKWh}`);
      // The current hours state-of-charge is equal to the prior hours soc + energy charged
      constraints.push(`soc_h${h - 1} - bat_kw_h${h} - soc_h${h} = 0`);
    }
  }
  const problem = `Minimize
        obj: ${objectives.join(" + ")}
        Subject To
          ${constraints.join("\n            ")}
        Bounds
          ${bounds.join("\n            ")}
        End`;
  try {
    const sol = highs.solve(problem);

    console.log(sol)

    const result: DayResults = {
      day,
      timestamps: [],
      importPrice: [],
      exportPrice: [],
      importKW: [],
      exportKW: [],
      pvOutputKW: [],
      batteryKWh: [],
      uncontrolledLoad: [],
      batteryKWhAtEoD: (sol.Columns[`soc_h23`] as any)['Primal'],
      spec: {
        batteryKW:spec.batteryKW, batteryKWh: spec.batteryKWh, problem
      },
      solution: sol
    }
    for(let h=0;h<24;h++) {
      result.timestamps.push(day.records[h].hourStart);
      result.importPrice.push(day.records[h].importPrice);
      result.exportPrice.push(day.records[h].exportPrice);
      result.importKW.push((sol.Columns[`import_h${h}`] as any)['Primal']);
      result.exportKW.push((sol.Columns[`export_h${h}`] as any)['Primal']);
      result.exportPrice.push(day.records[h].exportPrice);
      result.uncontrolledLoad.push(day.records[h].consumptionKWh);
      result.pvOutputKW.push(day.records[h].pvProductionKWNormalized * spec.pvKW);
      result.batteryKWh.push((sol.Columns[`soc_h${h}`] as any)['Primal']);
    }
    return result;
  } catch(e) {
    console.log("Failed to solve", problem)
    console.log("failed input day", day, spec);
    throw e;
  }

}

export function preprocess(pvwatts: PVWattsDataset, tibberdata: TibberDataset) : InputRecord[] {
  let out:InputRecord[] = [];

  for(let tr of tibberdata) {
    let hourStart = new Date(tr.from);
    let yearStartUTC = new Date(Date.UTC(hourStart.getUTCFullYear()));
    let millisSinceStartOfUTCYear = hourStart.getTime() - yearStartUTC.getTime();
    let hoursIntoUtcYear = Math.floor(millisSinceStartOfUTCYear / 1000 / 60 / 60);
    while(isNaN(pvwatts.outputs.ac[hoursIntoUtcYear])) {
      // We miss one day if it's a leap year, so use prior day
      hoursIntoUtcYear -= 24;
    }
    const spotPrice = Math.round(tr.unitPrice + tr.unitPriceVAT * 1000) / 1000;
    const gridImportFee = 0.20 + 0.05 * spotPrice;
    const gridExportFee = 0.068 + 0.0561 * spotPrice;
    const energyTax = 0.549;
    out.push({
      hourStart,
      consumptionKWh: tr.consumption,
      importPrice: spotPrice + energyTax + gridImportFee,
      exportPrice: spotPrice + 0.6 - gridExportFee,
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