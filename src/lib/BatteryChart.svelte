<script lang="ts">
    import * as echarts from 'echarts';
  
    type DayResults = {
        "day": string, 
        "timestamps": string[], 
        "batteryKWh": number[], 
        "spotIncVAT": number[],
        "pvOutputKW": number[]
    };
    let {result} : {result: DayResults | null} = $props();
    
    let spotPriceChartEl: HTMLElement;
    let batteryKWhEl: HTMLElement;
    let pvOutputEl: HTMLElement;
    $effect(() => {
      if(result === null) {
          return;
      }
      const tooltip = {
        trigger: 'axis',
        axisPointer: {
          type: 'cross'
        }
      };
  
      const timestamps = result.timestamps.map(isodate => {
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
            data: result.spotIncVAT,
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
            data: result.batteryKWh,
          }
        ]
      });

      echarts.init(pvOutputEl).setOption({
        title: { text: 'PV Output', },
        tooltip,
        xAxis: {
          type: 'category',
          boundaryGap: false,
          data: timestamps
        },
        yAxis: {
          type: 'value',
          axisLabel: {
            formatter: '{value} kW'
          },
          axisPointer: {
            snap: true
          }
        },
        series: [
          {
            name: 'PV Output',
            type: 'line',
            smooth: true,
            // prettier-ignore
            data: result.pvOutputKW,
          }
        ]
      });
    });
  
  </script>
  
  <div style="width: 600px;height:400px;" bind:this={spotPriceChartEl}></div>
  <div style="width: 600px;height:400px;" bind:this={batteryKWhEl}></div>
  <div style="width: 600px;height:400px;" bind:this={pvOutputEl}></div>
  