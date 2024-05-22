<script lang="ts">
  import highsLoader from "highs";
  import BatteryChart from '$lib/BatteryChart.svelte';

  let apiKey: string = $state("");
  let status: string = $state("idle");
  let totalRevenue: number = $state(0);

  let selectedBatterySize = $state(12);
  let selectedBatteryPower = $state(6);

  let resultReflectsSettings = $state(false);

  type DayResults = {
    "day": string;
    "timestamps": string[]; 
    "batteryKWh": number[]; 
    "spotIncVAT": number[];
    "spec": {
      "problem": string;
      "batteryKW": number;
      "batteryKWh": number;
    };
  };
  let results: DayResults[] = $state([]);
  let selectDays: string[] = $state([]);
  let selectedDay: string = $state("");


  let selectedResult : DayResults | null = $state(null);
  $effect(() => {
    const matches = results.filter(r => r.day == selectedDay);
    if(matches.length == 0) {
      selectedResult = null;
      resultReflectsSettings = false;
    } else {
      selectedResult = matches[0];
      resultReflectsSettings = (
        selectedResult.spec.batteryKWh == selectedBatterySize
        && selectedResult.spec.batteryKW == selectedBatteryPower
      )
    }
  });
  
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
    const batteryKW = selectedBatteryPower;
    const batteryKWh = selectedBatterySize;

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
          bounds.push(`-${batteryKW} <= h${h}_energy <= ${batteryKW}`);
          
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
        const problem = `Minimize
          obj:
            ${objectives.join(" + ")}
          Subject To
            ${constraints.join("\n            ")}
          Bounds
            ${bounds.join("\n            ")}
          End`;
        const sol = highs.solve(problem);
        
        status = `day ${day} ${-1 * sol.ObjectiveValue}SEK`;
        totalRevenue += -1 * sol.ObjectiveValue;
        
        const result: DayResults = {
          day: energyData[horizonStart]['from'].split("T")[0],
          timestamps: [],
          spotIncVAT: [],
          batteryKWh: [],
          spec: {
            batteryKW, batteryKWh, problem
          }
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
        // make the UI move between optimised days because it's fun and shows computation progress
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

</script>

<p>Load your data by logging in using your Tibber customer credentials and getting a token <a href="https://developer.tibber.com/settings/access-token">here</a></p>
<p>Once you've done this once the data is cached in local storage</p>
<input type="text" placeholder="Paste your Tibber API token" bind:value={apiKey} />
<p>
<label>Battery Size<input type="number" placeholder="12" bind:value={selectedBatterySize} /> kWh</label>
</p>
<p>
<label>Battery Power<input type="number" placeholder="6" bind:value={selectedBatteryPower} /> kW</label>
</p>

<button onclick={runBatteryAnalysis}>Run battery analysis</button>
<pre>{status}</pre>
<pre>Revenue: {totalRevenue}SEK</pre>

<select bind:value={selectedDay}>
  {#each results as result} 
  <option value={result.day}>{result.day}</option>
  {/each}
</select>

{#if !resultReflectsSettings}
<p>Results don't match settings, click 'Run battery analysis' to re-run</p>
{/if}

<BatteryChart result={selectedResult} />

{#if selectedResult}
<pre>
  {selectedResult.spec.problem}
</pre>
{/if}