/* Plain words -> the variable they most likely mean. Shared by Researcher mode and the Ask page.
   Order matters: the first pattern that matches a stretch of text claims it. Ids are "dataset::column". */
const CONCEPTS = [
  [/life expectanc|live longer|lives? long|longevity|lifespan/, "world-bank-development::life_expectancy"], [/gdp per (capita|person|head)|rich|wealth|affluen|prosper|income/, "world-bank-development::gdp_per_capita"],
  [/co2 in the (air|atmosphere)|atmospheric co2|carbon dioxide (level|concentration)|ppm/, "atmospheric-co2::mauna_loa_ppm"], [/temperature|warm|hotter|heating/, "global-temperature::nasa_anomaly_c"],
  [/co2|carbon|emission|emit/, "co2-and-greenhouse-gases::co2_per_capita"], [/solar/, "energy::solar_share_elec"], [/\bwind\b/, "energy::wind_share_elec"], [/renewable|clean energy|green energy/, "energy::renewables_share_elec"], [/\bcoal\b/, "energy::coal_share_elec"],
  [/child mortality|under.?(5|five)|children d(ie|ying)/, "world-bank-development::under_5_mortality"], [/infant mortality|babies d(ie|ying)/, "world-bank-development::infant_mortality"], [/fertility|birth rate|children per woman|fewer (children|babies)/, "world-bank-development::fertility_rate"],
  [/internet|online/, "world-bank-development::internet_users"], [/urban|cities|city dwell/, "world-bank-development::urban_population_share"], [/health (spending|expenditure)|spend\w* (more )?on health/, "world-bank-development::health_spending_share_gdp"],
  [/education (spending|expenditure)|spend\w* (more )?on education/, "world-bank-development::education_spending_share_gdp"], [/inequal|unequal|gini/, "world-bank-development::gini_index"], [/unemploy|jobless/, "world-bank-development::unemployment"],
  [/inflation/, "world-bank-development::inflation"], [/poverty|\bpoor\b/, "world-bank-development::extreme_poverty_share"], [/economic growth|gdp growth|grow\w* econom/, "world-bank-development::gdp_growth"], [/\btrade\b|export/, "world-bank-development::exports_share_gdp"],
  [/school|enrol/, "world-bank-development::secondary_enrollment"], [/litera/, "world-bank-development::adult_literacy"], [/women in parliament|female (mps|politicians|lawmakers)/, "world-bank-development::women_in_parliament"],
  [/air pollution|pm2|smog/, "world-bank-development::pm25_air_pollution"], [/forest/, "world-bank-development::forest_area_share"], [/access to electricity|electricity access|electrif/, "world-bank-development::electricity_access"],
  [/military|defen[cs]e spending|arms/, "world-bank-development::military_spending_share_gdp"], [/touris/, "world-bank-development::tourist_arrivals"], [/mobile|phone/, "world-bank-development::mobile_subscriptions"], [/doctor|physician/, "world-bank-development::physicians"],
  [/hunger|undernourish|malnutrition/, "world-bank-development::undernourishment"], [/population density|crowded/, "world-bank-development::population_density"], [/population|number of people/, "world-bank-development::population"],
  [/oil price|price of oil|crude|brent|\boil\b/, "crude-oil-prices::brent_usd_per_barrel"], [/gas price|price of gas|natural gas/, "natural-gas-prices::henry_hub_usd_per_mmbtu"], [/energy (use|consumption)/, "energy::energy_per_capita"], [/\bgdp\b|economy|economic output/, "world-bank-development::gdp_current_usd"],
];

/* Everyday country names that differ from the names in the data, and a few shorthands. Values are ISO alpha-3 codes. */
const PLACE_ALIAS = { usa: "USA", us: "USA", "u s": "USA", america: "USA", "united states of america": "USA", "the states": "USA", uk: "GBR", "u k": "GBR", britain: "GBR", "great britain": "GBR", england: "GBR",
  uae: "ARE", emirates: "ARE", "south korea": "KOR", "north korea": "PRK", russia: "RUS", iran: "IRN", egypt: "EGY", turkey: "TUR", vietnam: "VNM", syria: "SYR", venezuela: "VEN", laos: "LAO",
  "ivory coast": "CIV", "czech republic": "CZE", slovakia: "SVK", kyrgyzstan: "KGZ", yemen: "YEM", gambia: "GMB", bahamas: "BHS", drc: "COD", "dr congo": "COD", "hong kong": "HKG", macau: "MAC",
  holland: "NLD", burma: "MMR", "cape verde": "CPV", swaziland: "SWZ", "east timor": "TLS", palestine: "PSE", world: "WLD", global: "WLD", globally: "WLD", worldwide: "WLD", "the world": "WLD", earth: "WLD" };
