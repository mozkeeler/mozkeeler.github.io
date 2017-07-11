var gCAs = [];
var gHeaders = [];

var req = new XMLHttpRequest();
req.open("GET", "IncludedCACertificateReportPEMCSV");
req.onload = (evt) => {
  parseCSV(req.responseText);
};
req.send();

function addHeader(header) {
  let columns = document.getElementById("columns");
  let td = document.createElement("td");
  td.textContent = header;
  columns.appendChild(td);
}

function addCA(ca, primaryField, extraFields) {
  let CAs = document.getElementById("CAs");
  let tr = document.createElement("tr");
  let td = document.createElement("td");
  td.textContent = ca[primaryField];
  td.classList.add("ca");
  let extraInfoTable = document.createElement("table");
  td.onclick = (evt) => { handleCAClick(td, extraInfoTable, evt); };
  for (let field of extraFields) {
    let tr = document.createElement("tr");
    let fieldNameTD = document.createElement("td");
    fieldNameTD.classList.add("fieldName");
    fieldNameTD.textContent = gHeaders[field];
    tr.appendChild(fieldNameTD);
    let valueTD = document.createElement("td");
    valueTD.textContent = ca[field];
    tr.appendChild(valueTD);
    extraInfoTable.appendChild(tr);
  }
  extraInfoTable.classList.add("hidden");
  td.appendChild(extraInfoTable);
  tr.appendChild(td);
  CAs.appendChild(tr);
}

function handleCAClick(td, table, evt) {
  for (let child of evt.target.children) {
    if (child == table) {
      table.classList.toggle("hidden");
      td.classList.toggle("selected");
      break;
    }
  }
}

function parseCSV(csv) {
  let lines = csv.split("\n");
  let headerLine = lines.shift();
  for (let header of headerLine.split(/"(,")?/)) {
    if (header && header != ',"') {
      gHeaders.push(header);
    }
  }
  console.log(gHeaders);
  addHeader(gHeaders[3]); // "Common Name or Certificate Name"
  let readingCertificate = false;
  let certificatePEM = "-----BEGIN CERTIFICATE-----";
  let ca = [];
  let line = lines.shift();
  while (line && line.length > 0) {
    if (readingCertificate) {
      if (line == "-----END CERTIFICATE-----'\"") {
        readingCertificate = false;
        certificatePEM += "\n-----END CERTIFICATE-----";
        ca.push(certificatePEM);
        certificatePEM = "-----BEGIN CERTIFICATE-----";
        // the first element is the leading match on ", so shift it off
        ca.shift();
        gCAs.push(ca);
        ca = [];
      } else {
        certificatePEM += "\n" + line;
      }
    } else {
      for (let field of line.split(/"(,")?/)) {
        if (field != undefined && field != ',"' &&
            field != "'-----BEGIN CERTIFICATE-----") {
          ca.push(field);
        }
      }
      readingCertificate = true;
    }
    line = lines.shift();
  }
  for (let ca of gCAs) {
    addCA(ca, 3, [27, 19, 0, 11]);
  }
  console.log(gCAs);
}
