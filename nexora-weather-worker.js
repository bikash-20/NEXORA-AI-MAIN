/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║        NEXORA — Weather Backend Worker v1.0                     ║
 * ║  Provides accurate weather with OpenWeatherMap API              ║
 * ║  Endpoint: POST /weather                                        ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * SETUP:
 * 1. Deploy this to Cloudflare Workers
 * 2. Add environment variable: OPENWEATHER_API_KEY = your_api_key
 * 3. Update nexora-ai.js to call this endpoint
 *
 * BINDINGS REQUIRED (Workers → Settings → Variables & Bindings):
 *   OPENWEATHER_API_KEY → Your OpenWeatherMap API key
 */

// ── Router ──────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return cors(null, 204);
    const url = new URL(request.url);

    // Health check
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return cors(JSON.stringify({
        status: 'ok',
        worker: 'Nexora Weather Backend v1.0',
        endpoints: ['/weather'],
        timestamp: new Date().toISOString(),
      }));
    }

    if (request.method === 'POST' && url.pathname === '/weather') {
      return handleWeather(request, env);
    }

    return cors(JSON.stringify({ error: 'Not found' }), 404);
  }
};

// ══════════════════════════════════════════════════════════════════════
//  /weather  — Get accurate weather for any location
//
//  Request body:
//    { location: string, units?: 'metric'|'imperial' }
//
//  Response:
//    { ok: true, location, temp, feels_like, description, humidity, wind_speed, ... }
// ══════════════════════════════════════════════════════════════════════
async function handleWeather(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return cors(JSON.stringify({ error: 'Invalid JSON body' }), 400); }

  const { location, units = 'metric' } = body;
  if (!location || location.trim().length === 0)
    return cors(JSON.stringify({ error: 'location is required' }), 400);

  if (!env.OPENWEATHER_API_KEY)
    return cors(JSON.stringify({
      error: 'Weather API key not configured on server',
      hint: 'Add OPENWEATHER_API_KEY to Cloudflare Workers environment variables'
    }), 500);

  try {
    // Step 1: Geocode location name to coordinates
    const geoUrl = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(location)}&limit=1&appid=${env.OPENWEATHER_API_KEY}`;
    const geoRes = await fetch(geoUrl);
    
    if (!geoRes.ok) {
      return cors(JSON.stringify({
        error: `Geocoding failed: ${geoRes.status}`,
        hint: 'Check your API key and location name'
      }), geoRes.status);
    }

    const geoData = await geoRes.json();
    if (!geoData || geoData.length === 0) {
      return cors(JSON.stringify({
        error: `Location "${location}" not found`,
        hint: 'Try a different city name or country'
      }), 404);
    }

    const { lat, lon, name, country, state } = geoData[0];

    // Step 2: Get weather for coordinates
    const weatherUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=${units}&appid=${env.OPENWEATHER_API_KEY}`;
    const weatherRes = await fetch(weatherUrl);

    if (!weatherRes.ok) {
      return cors(JSON.stringify({
        error: `Weather fetch failed: ${weatherRes.status}`,
        hint: 'API service temporarily unavailable'
      }), weatherRes.status);
    }

    const weather = await weatherRes.json();
    const { main, weather: conditions, wind, clouds, sys } = weather;

    // Format response
    const tempUnit = units === 'metric' ? '°C' : '°F';
    const speedUnit = units === 'metric' ? 'km/h' : 'mph';
    const windSpeed = units === 'metric' 
      ? (wind.speed * 3.6).toFixed(1)  // m/s to km/h
      : (wind.speed * 2.237).toFixed(1); // m/s to mph

    const locationStr = state ? `${name}, ${state}, ${country}` : `${name}, ${country}`;
    const description = conditions[0].main;
    const icon = conditions[0].icon;

    return cors(JSON.stringify({
      ok: true,
      location: locationStr,
      coordinates: { lat, lon },
      temperature: Math.round(main.temp),
      feels_like: Math.round(main.feels_like),
      description,
      icon,
      humidity: main.humidity,
      pressure: main.pressure,
      wind_speed: windSpeed,
      wind_direction: wind.deg,
      cloudiness: clouds.all,
      visibility: (weather.visibility / 1000).toFixed(1),
      sunrise: new Date(sys.sunrise * 1000).toLocaleTimeString(),
      sunset: new Date(sys.sunset * 1000).toLocaleTimeString(),
      temp_unit: tempUnit,
      speed_unit: speedUnit,
      timestamp: new Date().toISOString(),
    }));

  } catch(e) {
    return cors(JSON.stringify({
      error: 'Weather service error: ' + (e?.message || String(e)),
      hint: 'Try again in a moment'
    }), 502);
  }
}

// ── CORS helper ─────────────────────────────────────────────────────
function cors(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
