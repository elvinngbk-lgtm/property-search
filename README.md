# MortgageGuru Property Search

Static site: `index.html` + `data.js` (generated) + `logo.png`.

## Update the data
1. Export the latest properties TSV.
2. Run: `python3 -I ../scripts/build_property_search.py ~/Downloads/properties_YYYY-MM-DD.tsv .`
3. Commit and push. GitHub Pages redeploys in about a minute.
