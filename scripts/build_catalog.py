"""Build docs/data/catalog.json from the pipe-delimited source list below.

Columns: name | region | domain | url | licence | commercial | update | api | buyers
commercial: yes = reuse in paid products is generally allowed; check = read the terms first;
            restricted = commercial reuse is limited or needs a licence.
The licence column is a starting point, not legal advice. Verify each source's terms before selling anything built on it.
"""
import json
from pathlib import Path

FED = "Public domain (US federal)"
ROWS = f"""
data.gov|US|Catalogs|https://data.gov|Varies by dataset|check|varies|yes|Analysts, civic tech
Maryland Open Data|US|Catalogs|https://opendata.maryland.gov|Open, varies by dataset|check|varies|yes|State contractors, nonprofits
Open Baltimore|US|Catalogs|https://data.baltimorecity.gov|Open, varies by dataset|check|varies|yes|City agencies, nonprofits, real estate
NYC Open Data|US|Catalogs|https://opendata.cityofnewyork.us|Open, varies by dataset|check|daily|yes|Real estate, civic tech, media
Chicago Data Portal|US|Catalogs|https://data.cityofchicago.org|Open, varies by dataset|check|daily|yes|Real estate, civic tech, media
FRED (St. Louis Fed)|US|Economy|https://fred.stlouisfed.org|Varies by series; some third-party|check|daily|yes|Finance, economists, consultants
Bureau of Economic Analysis|US|Economy|https://www.bea.gov/data|{FED}|yes|monthly|yes|Economists, site selection, finance
Bureau of Labor Statistics|US|Economy|https://www.bls.gov/data/|{FED}|yes|monthly|yes|HR, compensation, economists
Treasury Fiscal Data|US|Economy|https://fiscaldata.treasury.gov|{FED}|yes|daily|yes|Finance, policy analysts
USAspending|US|Economy|https://www.usaspending.gov|{FED}|yes|daily|yes|Government contractors, lobbyists
SAM.gov contract opportunities|US|Economy|https://sam.gov|{FED}|yes|daily|yes|Government contractors
Census American Community Survey|US|People and housing|https://www.census.gov/programs-surveys/acs|{FED}|yes|annual|yes|Retail, real estate, marketing
Census County Business Patterns|US|People and housing|https://www.census.gov/programs-surveys/cbp.html|{FED}|yes|annual|yes|Site selection, market sizing
Census Building Permits Survey|US|People and housing|https://www.census.gov/construction/bps/|{FED}|yes|monthly|no|Home builders, suppliers, lenders
HUD User datasets|US|People and housing|https://www.huduser.gov/portal/pdrdatas_landing.html|{FED}|yes|annual|yes|Landlords, housing nonprofits
FHFA House Price Index|US|People and housing|https://www.fhfa.gov/data/hpi|{FED}|yes|quarterly|no|Lenders, real estate investors
HMDA mortgage records|US|People and housing|https://ffiec.cfpb.gov|{FED}|yes|annual|yes|Lenders, fair-lending compliance
SEC EDGAR|US|Companies and finance|https://www.sec.gov/edgar|{FED}|yes|realtime|yes|Investors, competitive intelligence
FDIC BankFind|US|Companies and finance|https://banks.data.fdic.gov|{FED}|yes|quarterly|yes|Banks, fintech, investors
CFPB Consumer Complaints|US|Companies and finance|https://www.consumerfinance.gov/data-research/consumer-complaints/|{FED}|yes|daily|yes|Banks, compliance, law firms
SBA loan data|US|Companies and finance|https://data.sba.gov|{FED}|yes|quarterly|no|Lenders, B2B sales teams
USPTO patents and trademarks|US|Companies and finance|https://data.uspto.gov|{FED}|yes|weekly|yes|IP law firms, R&D strategy
EIA Open Data|US|Energy|https://www.eia.gov/opendata/|{FED}|yes|realtime|yes|Energy consultants, developers, traders
FERC eLibrary and forms|US|Energy|https://www.ferc.gov/industries-data|{FED}|yes|daily|no|Energy lawyers, developers
NREL data (NSRDB, ATB)|US|Energy|https://www.nrel.gov/research/data-tools.html|Open; check per dataset|check|annual|yes|Solar and wind developers
PJM Data Miner|US|Energy|https://dataminer2.pjm.com|Free; check redistribution terms|check|realtime|yes|Traders, developers, consultants
ERCOT data|US|Energy|https://www.ercot.com/gridinfo|Free; check redistribution terms|check|realtime|yes|Traders, developers, consultants
CAISO OASIS|US|Energy|https://oasis.caiso.com|Free; check redistribution terms|check|realtime|yes|Traders, storage developers
MISO market data|US|Energy|https://www.misoenergy.org/markets-and-operations/|Free; check redistribution terms|check|realtime|yes|Traders, developers
NYISO market data|US|Energy|https://www.nyiso.com/energy-market-operational-data|Free; check redistribution terms|check|realtime|yes|Traders, developers
ISO New England data|US|Energy|https://www.iso-ne.com/markets-operations|Free; check redistribution terms|check|realtime|yes|Traders, developers
SPP data|US|Energy|https://www.spp.org/markets-operations/|Free; check redistribution terms|check|realtime|no|Traders, wind developers
LBNL interconnection queues|US|Energy|https://emp.lbl.gov/queues|Open; cite source|check|annual|no|Developers, investors
EPA Air Quality System|US|Environment and climate|https://www.epa.gov/aqs|{FED}|yes|daily|yes|Health researchers, insurers
EPA Toxics Release Inventory|US|Environment and climate|https://www.epa.gov/toxics-release-inventory-tri-program|{FED}|yes|annual|yes|ESG analysts, law firms, real estate
EPA Greenhouse Gas Reporting|US|Environment and climate|https://www.epa.gov/ghgreporting|{FED}|yes|annual|yes|ESG analysts, carbon markets
EPA ECHO compliance|US|Environment and climate|https://echo.epa.gov|{FED}|yes|weekly|yes|Environmental due diligence, law firms
NOAA climate and weather (NCEI)|US|Environment and climate|https://www.ncei.noaa.gov|{FED}|yes|daily|yes|Insurers, agriculture, energy
NOAA Storm Events|US|Environment and climate|https://www.ncei.noaa.gov/stormevents/|{FED}|yes|monthly|no|Insurers, roofing and restoration
USGS Water Data|US|Environment and climate|https://waterdata.usgs.gov|{FED}|yes|realtime|yes|Utilities, engineering firms
USGS Earthquake Catalog|US|Environment and climate|https://earthquake.usgs.gov|{FED}|yes|realtime|yes|Insurers, engineers
OpenFEMA|US|Environment and climate|https://www.fema.gov/about/openfema|{FED}|yes|daily|yes|Insurers, real estate, emergency planners
NASA Earthdata|US|Environment and climate|https://www.earthdata.nasa.gov|Open (NASA data policy)|yes|daily|yes|Agriculture, climate risk, insurers
CDC WONDER|US|Health|https://wonder.cdc.gov|{FED}; use restrictions on small counts|check|annual|yes|Public health, pharma
CDC PLACES|US|Health|https://www.cdc.gov/places/|{FED}|yes|annual|yes|Hospitals, health nonprofits, insurers
CMS data (Medicare, hospitals)|US|Health|https://data.cms.gov|{FED}|yes|quarterly|yes|Hospitals, health consultants, pharma
Hospital price transparency files|US|Health|https://www.cms.gov/priorities/key-initiatives/hospital-price-transparency|Published by hospitals; check terms|check|annual|no|Employers, insurers, health startups
openFDA|US|Health|https://open.fda.gov|{FED}|yes|weekly|yes|Pharma, medical devices, law firms
ClinicalTrials.gov|US|Health|https://clinicaltrials.gov|{FED}|yes|daily|yes|Pharma, biotech investors
NIH RePORTER|US|Health|https://reporter.nih.gov|{FED}|yes|weekly|yes|Universities, biotech, grant consultants
USDA NASS Quick Stats|US|Agriculture and food|https://quickstats.nass.usda.gov|{FED}|yes|weekly|yes|Agribusiness, commodity traders
USDA Economic Research Service|US|Agriculture and food|https://www.ers.usda.gov/data-products/|{FED}|yes|monthly|no|Food companies, retailers
USDA FoodData Central|US|Agriculture and food|https://fdc.nal.usda.gov|{FED} (CC0)|yes|quarterly|yes|Food and nutrition apps
USDA Cropland Data Layer|US|Agriculture and food|https://www.nass.usda.gov/Research_and_Science/Cropland/|{FED}|yes|annual|no|Agribusiness, crop insurers
BTS airline on-time data|US|Transport|https://www.transtats.bts.gov|{FED}|yes|monthly|no|Travel companies, airports
NHTSA crashes and recalls|US|Transport|https://www.nhtsa.gov/data|{FED}|yes|daily|yes|Auto insurers, law firms, dealers
FMCSA carrier safety data|US|Transport|https://ai.fmcsa.dot.gov|{FED}|yes|monthly|yes|Freight brokers, insurers
National Transit Database|US|Transport|https://www.transit.dot.gov/ntd|{FED}|yes|monthly|no|Transit agencies, planners
GTFS transit feeds (Mobility Database)|World|Transport|https://mobilitydatabase.org|Varies by agency|check|weekly|yes|Mobility apps, planners
NCES and IPEDS|US|Education and labor|https://nces.ed.gov/ipeds/|{FED}|yes|annual|yes|Colleges, edtech, enrollment consultants
College Scorecard|US|Education and labor|https://collegescorecard.ed.gov/data/|{FED}|yes|annual|yes|Edtech, student advisers
O*NET|US|Education and labor|https://www.onetcenter.org/database.html|CC BY 4.0|yes|quarterly|yes|HR tech, career platforms
DOL H-1B and PERM disclosures|US|Education and labor|https://www.dol.gov/agencies/eta/foreign-labor/performance|{FED}|yes|quarterly|no|Immigration law firms, recruiters, job seekers
Congress.gov|US|Law and government|https://api.congress.gov|{FED}|yes|daily|yes|Lobbyists, policy teams
Federal Register|US|Law and government|https://www.federalregister.gov|{FED}|yes|daily|yes|Compliance teams, trade groups
Regulations.gov|US|Law and government|https://www.regulations.gov|{FED}|yes|daily|yes|Compliance teams, law firms
FEC campaign finance|US|Law and government|https://www.fec.gov/data/|{FED}; contributor lists may not be used for solicitation|check|daily|yes|Media, political consultants
FBI Crime Data Explorer|US|Law and government|https://cde.ucr.cjis.gov|{FED}|yes|quarterly|yes|Real estate, insurers, security firms
CourtListener|US|Law and government|https://www.courtlistener.com|Open (Free Law Project)|check|daily|yes|Law firms, legal tech
World Bank Open Data|World|Catalogs|https://data.worldbank.org|CC BY 4.0|yes|quarterly|yes|Development consultants, investors
UN Data|World|Catalogs|https://data.un.org|Varies by agency|check|varies|yes|Researchers, NGOs
Our World in Data|World|Catalogs|https://ourworldindata.org|CC BY 4.0 (own data; third-party varies)|check|varies|yes|Media, educators, analysts
EU Open Data Portal|World|Catalogs|https://data.europa.eu|Mostly CC BY 4.0|check|varies|yes|EU-facing businesses
data.gov.uk|World|Catalogs|https://www.data.gov.uk|Open Government Licence|yes|varies|yes|UK-facing businesses
India data.gov.in|World|Catalogs|https://www.data.gov.in|Government Open Data License - India|yes|varies|yes|India-facing businesses, NGOs
Humanitarian Data Exchange|World|Catalogs|https://data.humdata.org|Varies by dataset|check|varies|yes|NGOs, aid agencies
IMF Data|World|Economy and trade|https://data.imf.org|IMF terms; check commercial use|check|monthly|yes|Finance, country-risk analysts
OECD Data Explorer|World|Economy and trade|https://data-explorer.oecd.org|CC BY 4.0|yes|monthly|yes|Consultants, policy teams
UN Comtrade|World|Economy and trade|https://comtradeplus.un.org|UN terms; redistribution limits|restricted|monthly|yes|Importers, exporters, trade consultants
WTO Stats|World|Economy and trade|https://stats.wto.org|WTO terms; check|check|quarterly|yes|Trade consultants
BIS statistics|World|Economy and trade|https://data.bis.org|BIS terms; free reuse with attribution|check|quarterly|yes|Banks, macro investors
Eurostat|World|Economy and trade|https://ec.europa.eu/eurostat|Reuse allowed with attribution|yes|monthly|yes|EU market research
Penn World Table|World|Economy and trade|https://www.rug.nl/ggdc/productivity/pwt/|CC BY 4.0|yes|annual|no|Economists
UN SDG Global Database|World|Development and society|https://unstats.un.org/sdgs/dataportal|UN terms; check|check|annual|yes|ESG, NGOs, development finance
UNDP Human Development Data|World|Development and society|https://hdr.undp.org/data-center|CC BY 3.0 IGO|yes|annual|yes|NGOs, development finance
ILOSTAT|World|Development and society|https://ilostat.ilo.org|CC BY 4.0|yes|quarterly|yes|HR, supply-chain compliance
UNESCO Institute for Statistics|World|Development and society|https://uis.unesco.org|CC BY-SA 3.0 IGO|check|annual|yes|Edtech, NGOs
World Inequality Database|World|Development and society|https://wid.world|Open; cite source|check|annual|yes|Researchers, media
DHS Program surveys|World|Development and society|https://dhsprogram.com|Registration; research use|restricted|varies|yes|Health NGOs, researchers
WHO Global Health Observatory|World|Health|https://www.who.int/data/gho|WHO terms; check commercial use|check|annual|yes|Pharma, global health NGOs
IHME Global Burden of Disease|World|Health|https://www.healthdata.org/research-analysis/gbd|Free for non-commercial use only|restricted|annual|no|Researchers (licence needed commercially)
UNICEF Data|World|Health|https://data.unicef.org|UNICEF terms; check|check|annual|yes|NGOs, child-health programmes
UN World Population Prospects|World|Health|https://population.un.org/wpp/|CC BY 3.0 IGO|yes|annual|yes|Market sizing, insurers, planners
Ember electricity data|World|Energy|https://ember-energy.org/data/|CC BY 4.0|yes|monthly|yes|Energy analysts, investors, media
Energy Institute Statistical Review|World|Energy|https://www.energyinst.org/statistical-review|Free; check terms|check|annual|no|Energy analysts
IRENA statistics|World|Energy|https://www.irena.org/Data|Free with attribution; check|check|annual|no|Renewables developers, investors
Global Energy Monitor trackers|World|Energy|https://globalenergymonitor.org|CC BY 4.0|yes|quarterly|no|Investors, ESG, commodity analysts
ENTSO-E Transparency Platform|World|Energy|https://transparency.entsoe.eu|Free; check reuse terms|check|realtime|yes|European power traders
IEA data|World|Energy|https://www.iea.org/data-and-statistics|Mostly paid; limited free tier|restricted|annual|yes|Energy analysts
Global Carbon Project|World|Climate and emissions|https://globalcarbonbudget.org|CC BY 4.0|yes|annual|no|Climate analysts, media
EDGAR emissions database|World|Climate and emissions|https://edgar.jrc.ec.europa.eu|CC BY 4.0|yes|annual|no|Climate analysts, ESG
Climate Watch|World|Climate and emissions|https://www.climatewatchdata.org|CC BY 4.0 (some third-party)|check|annual|yes|ESG, policy teams
Climate TRACE|World|Climate and emissions|https://climatetrace.org|CC BY 4.0|yes|monthly|yes|ESG, supply-chain emissions, investors
Copernicus ERA5 reanalysis|World|Climate and emissions|https://cds.climate.copernicus.eu|Copernicus licence (commercial use allowed)|yes|daily|yes|Energy, agriculture, insurers
Berkeley Earth|World|Climate and emissions|https://berkeleyearth.org/data/|CC BY-NC 4.0|restricted|monthly|no|Researchers
Landsat (USGS)|World|Satellite and land|https://landsat.gsfc.nasa.gov|Public domain|yes|daily|yes|Agriculture, mining, insurers
Sentinel (Copernicus)|World|Satellite and land|https://dataspace.copernicus.eu|Copernicus licence (commercial use allowed)|yes|daily|yes|Agriculture, insurers, commodities
MODIS and VIIRS (NASA)|World|Satellite and land|https://lpdaac.usgs.gov|Open (NASA data policy)|yes|daily|yes|Agriculture, fire and flood risk
VIIRS night lights (EOG)|World|Satellite and land|https://eogdata.mines.edu/products/vnl/|Open; cite source|check|monthly|no|Economists, market sizing
Global Forest Watch|World|Satellite and land|https://www.globalforestwatch.org|CC BY 4.0|yes|weekly|yes|Supply-chain deforestation compliance
OpenStreetMap|World|Satellite and land|https://www.openstreetmap.org|ODbL (derived databases stay open)|check|realtime|yes|Logistics, retail site selection
WorldPop|World|Satellite and land|https://www.worldpop.org|CC BY 4.0|yes|annual|yes|Telecom, retail, NGOs
Google Earth Engine catalog|World|Satellite and land|https://developers.google.com/earth-engine/datasets|Platform is paid for commercial use; data varies|restricted|daily|yes|Geospatial teams
FAOSTAT|World|Food and agriculture|https://www.fao.org/faostat/|FAO terms; check commercial use|check|annual|yes|Agribusiness, commodity analysts
FAO Food Price Index|World|Food and agriculture|https://www.fao.org/worldfoodsituation/foodpricesindex/|FAO terms; check|check|monthly|no|Food companies, traders
WFP food prices|World|Food and agriculture|https://data.humdata.org/organization/wfp|CC BY IGO|yes|monthly|yes|NGOs, commodity analysts
AMIS market monitor|World|Food and agriculture|https://www.amis-outlook.org|Free; check terms|check|monthly|no|Grain traders
GBIF|World|Biodiversity and water|https://www.gbif.org|CC0, CC BY or CC BY-NC by dataset|check|daily|yes|Environmental consultants, nature-risk reporting
IUCN Red List|World|Biodiversity and water|https://www.iucnredlist.org|Non-commercial; licence needed commercially|restricted|annual|yes|Researchers (IBAT for business)
eBird|World|Biodiversity and water|https://ebird.org/data/download|Research and education use|restricted|monthly|yes|Researchers
FAO AQUASTAT|World|Biodiversity and water|https://www.fao.org/aquastat/|FAO terms; check|check|annual|no|Water consultants
JRC Global Surface Water|World|Biodiversity and water|https://global-surface-water.appspot.com|Copernicus licence (commercial use allowed)|yes|annual|no|Water risk, insurers
V-Dem|World|Governance and conflict|https://www.v-dem.net|Free; check terms|check|annual|no|Country-risk analysts
Worldwide Governance Indicators|World|Governance and conflict|https://www.worldbank.org/en/publication/worldwide-governance-indicators|CC BY 4.0|yes|annual|yes|Country-risk analysts
Corruption Perceptions Index|World|Governance and conflict|https://www.transparency.org/en/cpi|CC BY-ND 4.0|check|annual|no|Compliance teams
UCDP conflict data|World|Governance and conflict|https://ucdp.uu.se|CC BY 4.0|yes|monthly|yes|Security and country-risk firms
ACLED|World|Governance and conflict|https://acleddata.com|Commercial use needs a licence|restricted|weekly|yes|Security firms (licence needed)
GDELT|World|Governance and conflict|https://www.gdeltproject.org|Open; cite source|yes|realtime|yes|Media monitoring, risk analysts
OpenAlex|World|Science and tech|https://openalex.org|CC0|yes|monthly|yes|Universities, R&D intelligence
arXiv|World|Science and tech|https://arxiv.org/help/bulk_data|Metadata CC0; papers vary|check|daily|yes|R&D intelligence
Crossref|World|Science and tech|https://www.crossref.org/documentation/retrieve-metadata/|Metadata open (facts, CC0)|yes|daily|yes|Publishers, research analytics
GH Archive|World|Science and tech|https://www.gharchive.org|CC BY 4.0 (code); GitHub terms on data|check|realtime|yes|Developer-tool companies, investors
Stack Exchange data dump|World|Science and tech|https://archive.org/details/stackexchange|CC BY-SA|check|quarterly|no|Developer-tool companies
Common Crawl|World|Science and tech|https://commoncrawl.org|Open corpus; page content has own rights|check|monthly|yes|Search and AI companies
Wikidata|World|Science and tech|https://www.wikidata.org|CC0|yes|realtime|yes|Knowledge-graph and search products
Wikipedia pageviews|World|Science and tech|https://dumps.wikimedia.org/other/pageviews/|CC0|yes|daily|yes|Media, brand and trend tracking
"""

def main():
    out = []
    for line in ROWS.strip().splitlines():
        p = [x.strip() for x in line.split("|")]
        assert len(p) == 9, line
        assert p[1] in ("US", "World") and p[5] in ("yes", "check", "restricted") and p[7] in ("yes", "no"), line
        assert p[6] in ("realtime", "daily", "weekly", "monthly", "quarterly", "annual", "varies"), line
        out.append(dict(name=p[0], region=p[1], domain=p[2], url=p[3], licence=p[4], commercial=p[5],
                        update=p[6], api=p[7] == "yes", buyers=p[8]))
    assert len({r["name"] for r in out}) == len(out)
    dest = Path(__file__).resolve().parents[1] / "docs" / "data" / "catalog.json"
    dest.write_text(json.dumps({"count": len(out), "sources": out}, indent=1))
    print(len(out), "sources ->", dest)

if __name__ == "__main__":
    main()
