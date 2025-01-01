import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export async function GET() {
    const params = new URLSearchParams({
        api_key: env.VITE_PVWATTS_API_KEY,
        system_capacity: "1",
        module_type: "0", // 0=standard,1=premium,2=thin-film
        losses: "5", // -5% -> 99%
        array_type: "1", // 0=fixed ground,1=fixed roof, several others, see docs

        tilt: "18", // 0->90, degrees
        azimuth: "145", // 0->360, degrees
        
        timeframe: "hourly",

        // Search radius to find weather data, 0=closest station independent of distance
        radius: "500", 
        lat: "55.746",
        lon: "13.255",
        dataset: "intl",

    }).toString()
    const res = await fetch(`https://developer.nrel.gov/api/pvwatts/v8.json?${params}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });
    const raw = await res.json();
    return json({
        outputs: raw.outputs,
        station_info: raw.station_info,
        errors: raw.errors,
        warnings: raw.warnings,
    });
}