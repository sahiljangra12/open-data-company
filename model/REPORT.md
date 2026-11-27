# Sustainability and policy matcher: results

Trained 2026-11-27 on GitHub's own machine in 23.4 minutes. Base model: `sentence-transformers/all-MiniLM-L6-v2`.

- 980 numeric variables on the site were the possible answers to every question.
- 611 of them, in the sustainability and policy datasets, had training questions (7443 in all).
- The hand-written questions were never used for training.

## 95 hand-written questions

| | First answer right | Right answer in the first five |
|---|---|---|
| Keyword search (used today) | 42.1% | 62.1% |
| Open model, before training | 47.4% | 81.1% |
| Our matcher, after training | 70.5% | 89.5% |

## 611 held-out generated questions

| | First answer right | Right answer in the first five |
|---|---|---|
| Keyword search (used today) | 84.1% | 94.1% |
| Open model, before training | 60.2% | 86.1% |
| Our matcher, after training | 89.2% | 96.1% |

## Questions it now gets right that keyword search could not find

- all greenhouse gases put out by the United States → `climate-trace-emissions::greenhouse_gas_emissions`
- Is India's CO2 still growing from one year to the next? → `co2-and-greenhouse-gases::co2_growth_prct`
- landfill and rubbish emissions → `emissions-by-sector::ghg_waste`
- factory emissions in India → `emissions-by-sector::ghg_manufacturing_and_construction`
- How much of Germany's power comes from wind? → `energy::wind_share_elec`
- How much electricity does Norway get from dams? → `energy::hydro_share_elec`
- grams of CO2 for each kilowatt-hour of electricity in India → `energy::carbon_intensity_elec`
- energy used per person in Canada → `co2-and-greenhouse-gases::energy_per_capita`
- people living on coast land less than 5 metres above the sea → `environment-indicators::population_living_in_areas_where_elevation_is_below`
- forest cut down each year in Brazil → `forests-wildlife-and-plastic::deforestation`
- plastic leaking into the sea from the Philippines → `forests-wildlife-and-plastic::plastic_waste_emitted_to_the_ocean`
- deaths from heatwaves and cold spells per 100,000 people → `natural-disasters::death_rate_from_extreme_temperatures`

## Questions it still gets wrong

- How much carbon does India pump out each year? → it said `climate-trace-emissions::co2`
- carbon footprint of an average American → it said `human-development-index::material_footprint_per_person`
- How carbon-heavy is China's economy for each dollar it makes? → it said `europe-eurostat::inflation`
- Who is historically most responsible for CO2, adding up every year so far? → it said `co2-and-greenhouse-gases::co2`
- Emissions caused by what the UK buys and consumes, imports included → it said `world-bank-development::imports_share_gdp`
- How green is Brazil's grid? → it said `us-river-flow-monthly::hudson_at_green_island`
- clean electricity share, nuclear plus renewables, in France → it said `energy::nuclear_share_elec`
- CO2 concentration in the air right now → it said `world-bank-development::pm25_air_pollution`
- dirty air: fine particles people breathe in India → it said `world-bank-development::pm25_air_pollution`
- grain harvested per hectare in India → it said `world-bank-development::agriculture_share_gdp`
