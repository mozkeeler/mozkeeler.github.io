"use strict";

var modules = {};
var sort = "count";

function compare(keyA, keyB) {
  if (sort == "name") {
    return keyA.localeCompare(keyB);
  }
  if (sort == "count") {
    return modules[keyB] - modules[keyA];
  }
  throw new Error(`unknown sort '${sort}'`);
}

function updateTableDisplay() {
  let container = document.getElementById("modules");
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
  Object.keys(modules).sort(compare).forEach((key) => {
    let tr = document.createElement("tr");
    let keyTD = document.createElement("td");
    keyTD.textContent = key;
    let countTD = document.createElement("td");
    countTD.textContent = modules[key];
    tr.appendChild(keyTD);
    tr.appendChild(countTD);
    container.appendChild(tr);
  });
}

var nssModules = [
  "LIBNSSCKBI.DYLIB",
  "LIBNSSCKBI.SO",
  "NSS INTERNAL FIPS PKCS #11 MODULE",
  "NSS INTERNAL PKCS #11 MODULE",
  "NSSCKBI.DLL",
];

function normalize(moduleName) {
  if (moduleName.includes("/")) {
    moduleName = moduleName.substring(moduleName.lastIndexOf("/") + 1);
  }
  if (nssModules.includes(moduleName)) {
    return "(NSS default module)";
  }
  return moduleName;
}

function main() {
  setupSorts();
  let versions = ["55", "56"];
  let channels = ["aurora", "beta", "nightly"];
  for (let version of versions) {
    for (let channel of channels) {
      Telemetry.getEvolution(channel, version,
                             "SCALARS_SECURITY.PKCS11_MODULES_LOADED", {},
                             false, (evolutionMap) => {
        Object.keys(evolutionMap).forEach((mapKey) => {
          let normalizedKey = normalize(mapKey);
          if (!(normalizedKey in modules)) {
            modules[normalizedKey] = 0;
          }
          evolutionMap[mapKey].map((histogram, i, date) => {
            modules[normalizedKey] += histogram.count;
          });
        });
        updateTableDisplay();
      });
    }
  }
}

function handleClick(evt) {
  let clicked = evt.target.id.substring(0, evt.target.id.indexOf("Header"));
  if (sort != clicked) {
    document.getElementById("nameHeader").classList.toggle("sort");
    document.getElementById("countHeader").classList.toggle("sort");
    sort = clicked;
    updateTableDisplay();
  }
}

function setupSorts() {
  document.getElementById("nameHeader").addEventListener("click", handleClick);
  document.getElementById("countHeader").addEventListener("click", handleClick);
}

Telemetry.init(main);
