<script lang="ts">
  import type { Highs, HighsSolution } from "highs";
  import * as analysis from '$lib/analysis';

  let {result} : {result: analysis.DayResults | null} = $props();

  let hours: string[] = $state([]);
  let cols: string[] = $state([]);

  $effect(() => {
    if(result === null) {
      return;
    }
    const numHours = Object.keys(result.solution.Columns).filter(c => c.startsWith("import_h")).length
    hours = [];
    for(let h=0;h<numHours;h++) {
        hours.push(`h${h}`)
    }

    // infer columns
    cols = Object.keys(result.solution.Columns).filter(c => c.includes("_h0")).map(c => c.replace('_h0', ''));

  });
</script>

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