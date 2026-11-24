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
/* Words for the wider set of datasets. CONCEPTS_FIRST is tried before everything else, because its phrases contain a word
   that an older pattern would otherwise claim ("nuclear weapons" is not nuclear power). CONCEPTS_MORE is tried after the
   Ask page's own first list and before CONCEPTS. A pattern whose dataset is missing is skipped. */
const CONCEPTS_FIRST = [
  [/nuclear (weapons?|warheads?|bombs?|arsenals?)|warheads?/, "conflict-and-security::nuclear_warheads"], [/healthy life expectanc/, "who-health-observatory::healthy_life_expectancy"],
  [/emissions? (from|by|of) (transport|cars|vehicles)|transport emissions?/, "emissions-by-sector::ghg_transport"], [/emissions? (from|by|of) (agriculture|farming|farms)|(agricultur\w+|farming) emissions?/, "emissions-by-sector::ghg_agriculture"],
  [/emissions? (from|by|of) (electricity|power|heat)|power sector emissions?/, "emissions-by-sector::ghg_electricity_and_heat"], [/emissions? (from|by|of) (industry|factories)|industrial emissions?/, "emissions-by-sector::ghg_industry"],
  [/emissions? (from|by|of) buildings?|building emissions?/, "emissions-by-sector::ghg_buildings"], [/(richest|top) (1|one) ?(%|percent)|income share of the (rich|top)/, "top-incomes::income_share_top_1_pct"],
  [/(richest|top) (10|ten) ?(%|percent)/, "top-incomes::income_share_top_10_pct"], [/solar (capacity|installed)|installed solar/, "renewable-capacity::solar_capacity"], [/wind (capacity|installed)|installed wind/, "renewable-capacity::wind_capacity"],
  [/chicago/, "chicago-crime-monthly::all_reported_crimes"], [/(us|american|federal|national) debt in dollars|debt clock|total public debt/, "us-national-debt::total_public_debt"],
  [/core inflation/, "us-economy-monthly::core_inflation"], [/wage growth|hourly earnings|hourly wages?/, "us-economy-monthly::wage_growth"], [/fed(eral)? funds|fed rate|fed s rate|federal reserve rate/, "us-economy-monthly::federal_funds_rate"],
  [/energy (use|consumption) per (capita|person|head)/, "energy::energy_per_capita"], [/population growth/, "un-population::population_growth_rate"], [/death rate from (all )?(natural )?disasters?/, "natural-disasters::death_rate_from_all_natural_disasters"],
];
const CONCEPTS_MORE = [
  [/democra/, "democracy-and-rights::electoral_democracy_index"], [/human rights/, "democracy-and-rights::human_rights_index"], [/press freedom|free press|media freedom|freedom of the press/, "democracy-and-rights::press_freedom_index"],
  [/corrupt/, "democracy-and-rights::corruption_perceptions_index"], [/rule of law/, "governance-indicators::rule_of_law"], [/political stability/, "governance-indicators::political_stability_and_absence_of_violence"],
  [/government effectiveness|best governed|well governed/, "governance-indicators::government_effectiveness"], [/regulatory quality/, "governance-indicators::regulatory_quality"],
  [/women s political|women in politics/, "democracy-and-rights::womens_political_empowerment_index"],
  [/happ(y|i)\w*|unhapp\w*|life satisfaction/, "wellbeing-and-schooling::life_satisfaction"], [/working hours|hours worked|work(s|ing)? the (most|longest|least)|work week/, "wellbeing-and-schooling::working_hours_per_worker"],
  [/years of school\w*/, "wellbeing-and-schooling::average_years_of_schooling"], [/human development|\bhdi\b/, "human-development-index::human_development_index"], [/gender inequality/, "human-development-index::gender_inequality_index"],
  [/obes/, "who-health-observatory::adults_with_obesity"], [/overweight/, "who-health-observatory::adults_overweight"], [/smok|tobacco|cigarette/, "who-health-observatory::adults_using_tobacco"],
  [/alcohol|drinking|drinks? the most/, "who-health-observatory::alcohol_per_adult"], [/suicide/, "who-health-observatory::suicide_rate"], [/road (traffic )?(deaths?|fatalit\w+|accidents?)|traffic deaths?/, "who-health-observatory::road_traffic_death_rate"],
  [/blood pressure|hypertension/, "who-health-observatory::adults_with_raised_blood_pressure"], [/nurses?|midwi\w+/, "who-health-observatory::nurses_and_midwives"], [/dentists?/, "who-health-observatory::dentists"],
  [/median age|average age/, "un-population::median_age"], [/sex ratio/, "un-population::sex_ratio"],
  [/homicide|murder/, "conflict-and-security::homicide_rate"], [/refugees?/, "conflict-and-security::refugees_by_origin"], [/terroris/, "conflict-and-security::terrorism_deaths"],
  [/(war|conflict|battle) deaths?|deaths? (in|from) (wars?|armed conflicts?|conflicts?)/, "conflict-and-security::deaths_in_armed_conflicts"],
  [/calorie/, "food-supply::daily_calorie_supply_per_person"], [/\bmeat\b/, "food-supply::meat_supply_per_person"],
  [/deforestation/, "forests-wildlife-and-plastic::deforestation"], [/tree cover/, "forests-wildlife-and-plastic::tree_cover_loss"], [/plastic/, "forests-wildlife-and-plastic::plastic_waste_emitted_to_the_ocean"],
  [/threatened species|endangered|red list|extinct/, "forests-wildlife-and-plastic::red_list_index"],
  [/floods?/, "natural-disasters::people_affected_by_floods"], [/droughts?/, "natural-disasters::people_affected_by_droughts"], [/wildfires?|forest fires?/, "natural-disasters::people_affected_by_wildfires"],
  [/storms?|hurricanes?|cyclones?|typhoons?/, "natural-disasters::people_affected_by_storms"], [/heat ?waves?|extreme (heat|temperatures?)/, "natural-disasters::people_affected_by_extreme_temperatures"],
  [/natural disasters?|disasters?/, "natural-disasters::people_affected_by_all_natural_disasters"],
  [/satellites?|launched into space|space launch\w*|rockets?/, "space-and-ai::objects_launched_into_space"], [/artificial intelligence|\bai (research|papers)/, "space-and-ai::ai_research_papers"],
  [/research papers?|scientific papers?|scientific publications?|academic papers?/, "research-papers-by-country::works"], [/arxiv/, "research-papers-by-year::arxiv_papers"],
  [/github|software developers?|programmers?|coders?/, "github-activity-by-country::developers"], [/wikipedia/, "wikipedia-pageviews::english_wikipedia"],
  [/biodiversity|species records?|wildlife records?/, "biodiversity-records-by-country::all_records"],
  [/(government|public|national|sovereign|federal) debt/, "imf-world-economic-outlook::government_debt"], [/(budget|fiscal|government) (deficit|surplus|balance)/, "imf-world-economic-outlook::government_balance"],
  [/current account/, "imf-world-economic-outlook::current_account_balance"], [/share of (the )?world (gdp|economy)/, "imf-world-economic-outlook::share_of_world_gdp"],
  [/(10|ten).?year (treasury|yield|bond)|treasury yield|bond yields?/, "us-rates-and-currencies-daily::treasury_10_year"], [/yield curve/, "us-rates-and-currencies-daily::yield_curve_10_year_minus_2_year"],
  [/euro (exchange|rate|to dollar)|dollars? (per|to|vs) euro|euro (vs|to|against) (the )?dollar|eur ?usd/, "us-rates-and-currencies-daily::dollars_per_euro"], [/rupees?/, "us-rates-and-currencies-daily::rupees_per_dollar"],
  [/yuan|renminbi/, "us-rates-and-currencies-daily::yuan_per_dollar"], [/\byen\b/, "us-rates-and-currencies-daily::yen_per_dollar"],
  [/payrolls?|jobs report|jobs added/, "us-economy-monthly::nonfarm_payrolls"], [/job openings?|vacancies/, "us-economy-monthly::job_openings"], [/housing starts?/, "us-economy-monthly::housing_starts"],
  [/building permits?/, "us-economy-monthly::building_permits"], [/(house|home|housing) prices?/, "us-economy-monthly::house_price_index"], [/retail sales/, "us-economy-monthly::retail_sales"],
  [/money supply|\bm2\b/, "us-economy-monthly::money_supply_m2"], [/consumer price index|\bcpi\b/, "us-economy-monthly::consumer_price_index"], [/saving rate|savings rate/, "us-economy-monthly::personal_saving_rate"],
  [/industrial production/, "us-economy-monthly::industrial_production"], [/vehicle sales|car sales/, "us-economy-monthly::vehicle_sales"], [/corporate profits?/, "us-economy-quarterly::corporate_profits_after_tax"],
  [/\bflu\b|influenza/, "us-flu-hospital-admissions::united_states"], [/bank failures?|failed banks?|banks? fail\w*/, "us-bank-failures::bank_failures"], [/executive orders?/, "us-federal-register::executive_orders"],
  [/federal (rules|regulations)|new regulations/, "us-federal-register::final_rules"], [/disaster declarations?/, "us-disaster-declarations::all_declarations"], [/clinical (trials?|studies)|medical trials?/, "clinical-trials-started::studies_started"],
  [/drug side effects?|adverse (drug )?events?|side effects?/, "us-fda-reports::drug_side_effect_reports"], [/food recalls?/, "us-fda-reports::food_recalls"], [/drug recalls?/, "us-fda-reports::drug_recalls"],
  [/(traffic|car|vehicle|road) (crash\w*|collisions?)/, "nyc-traffic-crashes-monthly::crashes"], [/nih|medical research (projects|grants)/, "us-nih-research-projects::projects_funded"],
  [/rainfall|precipitation/, "environment-indicators::average_precipitation_in_depth"], [/protected (areas?|land)/, "environment-indicators::terrestrial_and_marine_protected_areas"],
];
const PLACE_ALIAS = { usa: "USA", us: "USA", "u s": "USA", america: "USA", "united states of america": "USA", "the states": "USA", uk: "GBR", "u k": "GBR", britain: "GBR", "great britain": "GBR", england: "GBR",
  uae: "ARE", emirates: "ARE", "south korea": "KOR", "north korea": "PRK", russia: "RUS", iran: "IRN", egypt: "EGY", turkey: "TUR", vietnam: "VNM", syria: "SYR", venezuela: "VEN", laos: "LAO",
  "ivory coast": "CIV", "czech republic": "CZE", slovakia: "SVK", kyrgyzstan: "KGZ", yemen: "YEM", gambia: "GMB", bahamas: "BHS", drc: "COD", "dr congo": "COD", "hong kong": "HKG", macau: "MAC",
  holland: "NLD", burma: "MMR", "cape verde": "CPV", swaziland: "SWZ", "east timor": "TLS", palestine: "PSE", world: "WLD", global: "WLD", globally: "WLD", worldwide: "WLD", "the world": "WLD", earth: "WLD" };
