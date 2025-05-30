<script lang="ts">
  import highsLoader from "highs";
  import BatteryChart from '$lib/BatteryChart.svelte';
  import SolutionDetails from '$lib/SolutionDetails.svelte';
  import * as analysis from '$lib/analysis';

  let apiKey: string = $state("");
  let status: string = $state("idle");
  let totalRevenue: number = $state(0);

  let selectedBatterySize = $state(12);
  let selectedBatteryPower = $state(6);

  let selectedPVKW = $state(10);

  let resultReflectsSettings = $state(false);

  let results: analysis.DayResults[] = $state([]);
  let selectDays: string[] = $state([]);
  let selectedDay: string = $state("");

  let selectedResult : analysis.DayResults | null = $state(null);
  $effect(() => {
    const matches = results.filter(r => r.day.dayName == selectedDay);
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
    status = "loading your historic meter data from Tibber..";
    const energyData = await loadEnergyData(apiKey);
    status = "modelling PV system output on historic weather data..";
    const pvForecast = await loadPVForecast();
    status = "crunching numbers..";

    const inputData = analysis.preprocess(pvForecast, energyData);
    const dayInputs = [analysis.toDayChunks(inputData)[100]];
    let currentStateOfCharge = 0;



    for(let dayInput of dayInputs) {
      const spec = {
        batteryKW: selectedBatteryPower,
        batteryKWh: selectedBatterySize,
        batteryKWhAtSoD: currentStateOfCharge,
        pvKW: selectedPVKW,
      };
      const dayOutput = analysis.analyzeOne(highs, spec, dayInput);
      currentStateOfCharge = dayOutput.batteryKWhAtEoD;

      // Record this in the UI state
      results.push(dayOutput);
      selectDays.push(dayOutput.day.dayName);
      selectedDay = dayOutput.day.dayName;
      await sleep(1);
    }

    status = "Done!";
  }

  function sleep(ms: number) {
      return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function loadEnergyData(token: string) : Promise<analysis.TibberDataset> {
    let cached = localStorage.getItem("energy_data");
    if(cached && token === "") {
      return JSON.parse(cached);
    }
    let cursorTs = btoa('2024-01-01T00:00:00Z');
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
                      unitPrice
                      unitPriceVAT
                      currency
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

  async function loadPVForecast() : Promise<analysis.PVWattsDataset> {
    let cachedRaw = localStorage.getItem("pv_forecast");
    if(cachedRaw) {
      // Obviously needs to be smarter if params change
      const cached = JSON.parse(cachedRaw);
      if(cached) {
        return cached;
      }
    }

    let res = await fetch('/api/pvwatts', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

    let raw = await res.json();
    localStorage.setItem("pv_forecast", JSON.stringify(raw));
    return raw;
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
<p>
<label>PV System Size (nominal)<input type="number" placeholder="20" bind:value={selectedPVKW} /> kW</label>
</p>

<button onclick={runBatteryAnalysis}>Run battery analysis</button>
<pre>{status}</pre>
<pre>Revenue: {totalRevenue}SEK</pre>

<select bind:value={selectedDay}>
  {#each results as result} 
  <option value={result.day.dayName}>{result.day.dayName}</option>
  {/each}
</select>

{#if !resultReflectsSettings}
<p>Results don't match settings, click 'Run battery analysis' to re-run</p>
{/if}

<BatteryChart result={selectedResult} />

<SolutionDetails result={selectedResult} />

{#if selectedResult}
<pre>
  {selectedResult.spec.problem}
</pre>
{/if}