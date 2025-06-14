<script lang="ts">
  import type { Highs, HighsSolution } from "highs";
  import * as analysis from '$lib/analysis';

  let {result} : {result: analysis.DayResults | null} = $props();

  let hours: string[] = $state([]);
  let cols: string[] = $state([]);

  if(result !== null) {
    const numHours = Object.keys(result.solution.Columns).filter(c => c.startsWith("import_h")).length
    hours = [];
    for(let h=0;h<numHours;h++) {
      hours.push(`h${h}`)
    }

    // infer columns
    cols = Object.keys(result.solution.Columns).filter(c => c.includes("_h0")).map(c => c.replace('_h0', ''));
  }
</script>

<style>
    table {
        width: 100%;
        border-collapse: collapse;
        font-family: sans-serif;
        font-size: 14px;
        margin: 1em 0;
    }

    th, td {
        padding: 8px 12px;
        border: 1px solid #ccc;
        text-align: right; /* Good for numbers */
    }

    th {
        background-color: #f5f5f5;
        text-align: center;
    }

    tr:nth-child(even) {
        background-color: #f9f9f9;
    }
</style>

{#if result}
<table>
    <tbody>
        <tr>
            <th>Hour</th>
            {#each cols as col}
            <th>{col}</th>
            {/each}
        </tr>
        {#each hours as hour}
        <tr>
            <th>{hour}</th>
            {#each cols as col}
                <td>{(result.solution.Columns[col + '_' + hour] as any)['Primal']}</td>
            {/each}
        </tr>
        {/each}
    </tbody>
</table>
{/if}