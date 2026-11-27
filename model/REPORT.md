# Sustainability and policy matcher: results

Trained 2026-11-27 on GitHub's own machine in 31.1 minutes. Base model: `sentence-transformers/all-MiniLM-L6-v2`.

- 989 numeric variables on the site were the possible answers to every question.
- 620 of them, in the sustainability and policy datasets, had training questions (7540 in all).
- The hand-written questions were never used for training.

## 105 hand-written questions

| | First answer right | Right answer in the first five |
|---|---|---|
| Keyword search (used today) | 42.9% | 64.8% |
| Open model, before training | 51.4% | 81.9% |
| Our matcher, after training | 74.3% | 88.6% |

## 620 held-out generated questions

| | First answer right | Right answer in the first five |
|---|---|---|
| Keyword search (used today) | 84.4% | 94.5% |
| Open model, before training | 61.1% | 86.5% |
| Our matcher, after training | 88.4% | 96.3% |

## Questions it now gets right that keyword search could not find

- all greenhouse gases put out by the United States → `climate-trace-emissions::greenhouse_gas_emissions`
- Is India's CO2 still growing from one year to the next? → `co2-and-greenhouse-gases::co2_growth_abs`
- landfill and rubbish emissions → `emissions-by-sector::ghg_waste`
- factory emissions in India → `emissions-by-sector::ghg_manufacturing_and_construction`
- How much of Germany's power comes from wind? → `energy::wind_share_elec`
- How much electricity does Norway get from dams? → `energy::hydro_share_elec`
- grams of CO2 for each kilowatt-hour of electricity in India → `energy::carbon_intensity_elec`
- energy used per person in Canada → `co2-and-greenhouse-gases::energy_per_capita`
- share of land under protection in Costa Rica → `environment-indicators::terrestrial_protected_areas`
- people living on coast land less than 5 metres above the sea → `environment-indicators::population_living_in_areas_where_elevation_is_below`
- forest cut down each year in Brazil → `forests-wildlife-and-plastic::deforestation`
- plastic leaking into the sea from the Philippines → `forests-wildlife-and-plastic::plastic_waste_emitted_to_the_ocean`

## Questions it still gets wrong

- carbon footprint of an average American → it said `human-development-index::material_footprint_per_person`
- How carbon-heavy is China's economy for each dollar it makes? → it said `climate-and-environment-policy::carbon_tax_price`
- Who is historically most responsible for CO2, adding up every year so far? → it said `co2-and-greenhouse-gases::co2`
- Emissions caused by what the UK buys and consumes, imports included → it said `world-bank-development::imports_share_gdp`
- How much do cars, trucks and planes emit in the US? → it said `us-economy-monthly::vehicle_sales`
- How green is Brazil's grid? → it said `us-river-flow-monthly::hudson_at_green_island`
- clean electricity share, nuclear plus renewables, in France → it said `energy::nuclear_share_elec`
- CO2 concentration in the air right now → it said `climate-trace-emissions::co2`
- dirty air: fine particles people breathe in India → it said `world-bank-development::pm25_air_pollution`
- How stretched are Egypt's water supplies? → it said `us-disaster-declarations::droughts`
- fresh water available for each person → it said `world-bank-development::basic_water_access`
- How much does Saudi Arabia spend subsidising oil and gas? → it said `co2-and-greenhouse-gases::share_global_oil_co2`
