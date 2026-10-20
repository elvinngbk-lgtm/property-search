# MortgageGuru Property Search

Static site. Data is read live from the Google Sheet (set `SHEET_ID` in `properties.js`);
`snapshot.csv` is a backup copy used only if the sheet can't be reached.

- Add or edit properties: edit the Google Sheet. The site picks it up on next page load.
- Cleaning (areas, bedrooms/size from Notes, CashOut) happens in `properties.js`.
