<script lang="ts">
  import highsLoader from "highs";

  let apiKey: string = $state("");
  let status: string = $state("idle");
  let totalRevenue: number = $state(0);

  type DayResults = {"day": string, "timestamps": string[], "batteryKWh": number[], "spotIncVAT": number[]};
  let results: DayResults[] = $state([]);
  let selectDays: string[] = $state([]);
  let selectedDay: string = $state("");
  
  async function runBatteryAnalysis() {
    totalRevenue = 0;
    results = [];
    selectDays = [];
    status = "loading lp solver";
    const highs = await highsLoader({
      locateFile: (file) => "https://lovasoa.github.io/highs-js/" + file
    });
    status = "loading data..";
    const energyData = await loadEnergyData(apiKey);
    status = "crunching numbers..";

    // For the data we have, what would be the impact of a battery?
    const days = Math.round(energyData.length / 24)
    const fuseSize = 20;
    const maxKW = 6;
    const batteryKWh = 12;

    let currentChargeKWh = 0;

    for(let day=0;day<days;day+=1) {
        const horizonStart = day * 24;
        const hours = Math.min(48, energyData.length - horizonStart);

        let objectives = [];
        let constraints = [];
        let bounds = [];

        for(let h=0;h<hours;h++) {
          const price = energyData[horizonStart + h]['unitPriceVAT'];
          objectives.push(`${price} h${h}_energy`)

          // In each hour we can charge +/- the inverter kW, notwithstanding state-of-charge
          bounds.push(`-${maxKW} <= h${h}_energy <= ${maxKW}`);
          
          if(h === 0) {
            // First hour must be exactly the initial state-of-charge
            constraints.push(`soc_h${h} = ${currentChargeKWh}`);
          } else {
            // Subsequent hours state-of-charge is bound by the battery capacity
            bounds.push(`0 <= soc_h${h} <= ${batteryKWh}`);
            // The current hours state-of-charge is equal to the prior hours soc + energy charged
            constraints.push(`soc_h${h - 1} + h${h}_energy - soc_h${h} = 0`);
          }
        }
        const PROBLEM = `Minimize
          obj:
            ${objectives.join(" + ")}
          Subject To
            ${constraints.join("\n            ")}
          Bounds
            ${bounds.join("\n            ")}
          End`;
        const sol = highs.solve(PROBLEM);
        
        status = `day ${day} ${-1 * sol.ObjectiveValue}SEK`;
        totalRevenue += -1 * sol.ObjectiveValue;
        console.log(highs);
        console.log(PROBLEM);
        console.log(sol);
        console.log(Object.values(sol['Columns']).map(r => [r['Name'], r['Primal']]))
        
        const result: DayResults = {
          day: energyData[horizonStart]['from'].split("T")[0],
          timestamps: [],
          spotIncVAT: [],
          batteryKWh: [],
        }
        for(let h=0;h<24;h++) {
          result.timestamps.push(energyData[horizonStart + h]['from']);
          result.spotIncVAT.push(energyData[horizonStart + h]['unitPriceVAT']);
          result.batteryKWh.push((sol.Columns[`soc_h${h}`] as any)['Primal'])
        }
        results.push(result);
        selectDays.push(result.day);
        selectedDay = result.day;

        currentChargeKWh = (sol.Columns[`soc_h23`] as any)['Primal'];
        await sleep(1);
    }
  }


  function sleep(ms: number) {
      return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function loadEnergyData(token: string) {
    let cached = localStorage.getItem("energy_data");
    if(cached && token === "") {
      return JSON.parse(cached);
    }
    let cursorTs = btoa('2023-01-01T00:00:00Z');
    let out = [];
    while(true) {
      let res = await fetch('https://api.tibber.com/v1-beta/gql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          query: `
            query EnergyData($cursorTs: String) {
              viewer {
                login
                home(id:"d8e2a13a-496d-4adc-99e9-e740f8f9b750") {
                  appNickname,
                  consumption(resolution:HOURLY, first:512, after: $cursorTs) {
                    pageInfo {
                      count
                      endCursor
                      hasNextPage
                    }
                    nodes{
                      from
                      consumption
                      cost
                      unitPriceVAT
                    }
                  }
                }
              }
            }`,
          variables: {
            "cursorTs": cursorTs,
          }
        })
      });

      let r = await res.json()
      const cr = r['data']['viewer']['home']['consumption'];

      out.push(...cr['nodes']);

      if(!cr['pageInfo']['hasNextPage']) {
        break;
      }
      cursorTs = cr['pageInfo']['endCursor'];
    }

    localStorage.setItem("energy_data", JSON.stringify(out));

    return out;
  }

  import * as echarts from 'echarts';

  let spotPriceChartEl: HTMLElement;
  let batteryKWhEl: HTMLElement;
  $effect(() => {
    const matches = results.filter(r => r.day == selectedDay);
    if(matches.length == 0) {
      return;
    }
    let res = matches[0];
    const tooltip = {
      trigger: 'axis',
      axisPointer: {
        type: 'cross'
      }
    };

    const timestamps = res.timestamps.map(isodate => {
      const hour = isodate.split("T")[1].split(":")[0];
      return hour
    });

    echarts.init(spotPriceChartEl).setOption({
      title: { text: 'Spot Price', },
      tooltip,
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: timestamps
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          formatter: '{value}kr'
        },
        axisPointer: {
          snap: true
        }
      },
      series: [
        {
          name: 'Spot Price',
          type: 'line',
          step: 'start',
          // prettier-ignore
          data: res.spotIncVAT,
        }
      ]
    });

    echarts.init(batteryKWhEl).setOption({
      title: { text: 'Battery State-of-Charge', },
      tooltip,
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: timestamps
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          formatter: '{value} kWh'
        },
        axisPointer: {
          snap: true
        }
      },
      series: [
        {
          name: 'Battery State-of-charge',
          type: 'line',
          smooth: true,
          // prettier-ignore
          data: res.batteryKWh,
        }
      ]
    });
  });

</script>

<p>Load your data by logging in using your Tibber customer credentials and getting a token <a href="https://developer.tibber.com/settings/access-token">here</a></p>
<p>Once you've done this once the data is cached in local storage</p>
<input type="text" placeholder="Paste your Tibber API token" bind:value={apiKey} />
<button onclick={runBatteryAnalysis}>Run battery analysis</button>
<pre>{status}</pre>
<pre>Revenue: {totalRevenue}SEK</pre>

<select bind:value={selectedDay}>
  {#each results as result} 
  <option value={result.day}>{result.day}</option>
  {/each}
</select>

<div style="width: 600px;height:400px;" bind:this={spotPriceChartEl}></div>
<div style="width: 600px;height:400px;" bind:this={batteryKWhEl}></div>
