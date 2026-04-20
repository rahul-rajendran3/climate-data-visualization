export function formatMetric(metric: string): string {
    return metric
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
}

export const METRIC_DESCRIPTIONS: Record<string, string> = {
    global_avg_temperature:
        'The mean surface temperature across the globe for a given year (°C). This is the single most cited indicator of climate change — rising averages confirm that the Earth is warming and serve as the baseline against which all other climate shifts are measured.',
    temperature_anomaly:
        'The difference between a year\'s average temperature and the long-term historical baseline (°C). Anomalies make it easy to see acceleration: a +1.2 °C anomaly today is far more alarming than the raw number alone, showing how fast we are departing from the climate humans have lived in for thousands of years.',
    max_temperature:
        'The highest temperature recorded during the year (°C). Extreme heat events directly threaten human health, agriculture, and infrastructure. Tracking the upper limit reveals whether dangerous heat extremes are becoming more frequent and intense.',
    min_temperature:
        'The lowest temperature recorded during the year (°C). Rising minimum temperatures — especially overnight lows — indicate that warming is consistent, not just daytime spikes. They also affect ecosystems that depend on cold seasons for dormancy and pest control.',
    co2_concentration_ppm:
        'The concentration of carbon dioxide in the atmosphere, measured in parts per million (ppm). CO₂ is the primary greenhouse gas driving current climate change. Each ppm increase traps more heat, making this the most direct measure of human industrial impact on the atmosphere.',
    annual_rainfall_mm:
        'Total precipitation over the year, in millimeters. Climate change disrupts rainfall patterns — some regions get wetter while others dry out. Tracking rainfall is essential for understanding water security, agricultural viability, and flood or drought risk.',
    sea_level_rise_mm:
        'The increase in global mean sea level relative to a baseline, in millimeters. Driven by melting ice sheets and the thermal expansion of warming oceans, sea level rise directly threatens coastal cities, small island nations, and hundreds of millions of people living near coastlines.',
    sea_surface_temperature:
        'The average temperature of the ocean\'s surface layer (°C). Warmer oceans fuel stronger hurricanes, bleach coral reefs, disrupt fisheries, and accelerate ice melt. As the ocean absorbs over 90% of excess heat from climate change, surface temperature is a critical early-warning indicator.',
    heatwave_days:
        'The number of days per year meeting the threshold for a heatwave event. Heatwaves are one of the deadliest consequences of climate change, causing excess mortality, crop failures, and power grid strain. An increasing count signals that extreme heat is becoming the new normal.',
    drought_index:
        'A composite index of drought severity, where higher values indicate more intense or prolonged dry conditions. Droughts reduce freshwater availability, devastate agriculture, and trigger wildfires. As temperatures rise and rainfall becomes erratic, drought frequency and severity are expected to worsen significantly.',
    flood_events_count:
        'The number of significant flood events recorded in a year. A warmer atmosphere holds more moisture, leading to heavier precipitation events and more frequent flooding. Floods are among the most costly and deadly climate-related disasters, displacing communities and destroying infrastructure.',
    forest_cover_percent:
        'The percentage of land area covered by forest. Forests absorb roughly 2.6 billion tonnes of CO₂ per year, acting as a critical carbon sink. Declining forest cover means less carbon is captured, accelerating atmospheric CO₂ buildup and amplifying warming.',
    deforestation_rate:
        'The annual rate of forest loss as a percentage. Deforestation is both a symptom and a cause of climate change — it releases stored carbon while removing future absorption capacity. High deforestation rates indicate unsustainable land use that undermines climate goals.',
    fossil_fuel_consumption:
        'Energy consumed from coal, oil, and natural gas. Fossil fuels are responsible for around 75% of global greenhouse gas emissions. Tracking consumption shows how dependent an economy remains on carbon-intensive energy and how quickly the transition to cleaner sources is (or isn\'t) happening.',
    renewable_energy_share:
        'The percentage of total energy supply from renewable sources such as solar, wind, and hydropower. Expanding renewable energy is the cornerstone of decarbonizing the global economy. A rising share directly reduces CO₂ emissions and indicates progress toward climate targets.',
    air_quality_index:
        'A composite measure of atmospheric pollution levels, where higher values mean worse air quality. Many air pollutants — such as particulate matter and ozone — share sources with greenhouse gases. Poor air quality is both a direct health crisis and a signal of the same fossil fuel combustion driving climate change.',
    predicted_temperature_2050:
        'The projected average surface temperature in 2050 based on current emission trends (°C). This forward-looking metric shows the stakes of inaction. Keeping this number close to today\'s values requires aggressive emissions reductions; higher projections signal catastrophic disruptions to ecosystems, food systems, and human societies.',
    climate_risk_index:
        'A composite score quantifying a country\'s overall exposure to climate-related hazards, including extreme weather, sea-level rise, and heat stress. It summarizes vulnerability in a single number, making it easy to identify which regions face the most urgent adaptation needs and where climate impacts are already being felt most severely.',
}
