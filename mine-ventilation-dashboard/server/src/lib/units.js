// Canonical stored units for every reading parameter.
const UNITS = {
  airflow: 'm³/min',
  velocity: 'm/s',
  ch4: '%vol',
  co2: '%vol',
  co: 'ppm',
  o2: '%vol',
  temp: '°C',
  wetBulb: '°C',
  humidity: '%',
  pressure: 'Pa',
  dust: 'mg/m³',
  fanRpm: 'rpm',
};

const PARAM_LABELS = {
  airflow: 'Airflow',
  velocity: 'Air velocity',
  ch4: 'CH₄',
  co2: 'CO₂',
  co: 'CO',
  o2: 'O₂',
  temp: 'Dry-bulb temperature',
  wetBulb: 'Wet-bulb temperature',
  humidity: 'Relative humidity',
  pressure: 'Pressure',
  dust: 'Respirable dust',
  fanRpm: 'Fan speed',
};

module.exports = { UNITS, PARAM_LABELS };
