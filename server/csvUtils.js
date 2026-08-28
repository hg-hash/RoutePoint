// Minimal RFC4180-ish CSV parser for the customer-import CSV (First Name,
// Last Name, Address, Phone Number). Quote-aware because the Address column
// routinely contains commas ("123 High Street, Sydney NSW 2000") — a naive
// split(",") would break those rows. Not pulled in as an npm dependency,
// since a four-column import doesn't need a general-purpose CSV library.
function parseCsvLine(line) {
  const fields = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

function parseCsv(text) {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter(line => line.trim() !== "");

  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = parseCsvLine(lines[0]).map(h => h.trim());
  const rows = lines.slice(1).map(line => parseCsvLine(line));
  return { headers, rows };
}

module.exports = { parseCsv };
