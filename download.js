const loadingDiv = document.querySelector('#loading');
const loadedDiv = document.querySelector('#loaded');
const visDiv = document.querySelector('#visualize');
const downloadAnchor = document.querySelector('#download');
const openAnchor = document.querySelector('#open');
const tableButton = document.querySelector('#table');
const timelineButton = document.querySelector('#timeline');

loadingDiv.style.display = "";
loadedDiv.style.display = "none";

const data_url_port = browser.runtime.connect({ name: 'data_url' });

let data_url;
data_url_port.onMessage.addListener((url) => {
    data_url = url;
    downloadAnchor.href = url;
    openAnchor.href = url;
    loadingDiv.style.display = "none";
    loadedDiv.style.display = "";
})

let DATA;
async function get_data() {
    if (DATA === undefined) {
        let response = await fetch(data_url);
        DATA = await response.json();
    }

    return DATA;
}

const TABLE_HEADER = [
    'title', 'begin', 'end', 'lat', 'lon', 'parent'
];

async function build_table() {
    visDiv.replaceChildren();
    const data = await get_data();
    const table = document.createElement('table');
    table.className = 'data-table';

    const thead = table.createTHead().insertRow();
    thead.insertCell().innerText = 'id';
    for (const col_name of TABLE_HEADER) {
        thead.insertCell().innerText = col_name;
    }

    const tbody = table.createTBody();
    for (const [id, row] of Object.entries(data)) {
        const tr = tbody.insertRow();
        tr.insertCell().innerText = id;
        for (const col_name of TABLE_HEADER) {
            let col_val = (col_name in row) ? row[col_name] : '';
            if (col_name === 'begin' || col_name === 'end' && col_val !== '') {
                col_val = formatDate(new Date(col_val));
            }
            tr.insertCell().innerText = col_val;
        }
    }
    visDiv.appendChild(table);
}

function createDateFormatter(locale) {
    const formatter = new Intl.DateTimeFormat(locale, {dateStyle: 'short', timeStyle: 'short'});
    return (date) => formatter.format(date);
}

const formatDate = createDateFormatter('en-US');

function divMod(n, m) {
    return [Math.floor(n / m), n % m];
}

function createDurationFormatter(locale, unitDisplay = 'long') {
  const
    timeUnitFormatter = (locale, unit, unitDisplay) =>
      Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay }).format,
    fmtDays = timeUnitFormatter(locale, 'day', unitDisplay),
    fmtHours = timeUnitFormatter(locale, 'hour', unitDisplay),
    fmtMinutes = timeUnitFormatter(locale, 'minute', unitDisplay),
    fmtSeconds = timeUnitFormatter(locale, 'second', unitDisplay),
    fmtMilliseconds = timeUnitFormatter(locale, 'millisecond', unitDisplay),
    fmtList = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' });
  return (milliseconds) => {
    let days, hours, minutes, seconds;
    // [days, milliseconds] = divMod(milliseconds, 864e5);
    [hours, milliseconds] = divMod(milliseconds, 36e5);
    [minutes, milliseconds] = divMod(milliseconds, 6e4);
    [seconds, milliseconds] = divMod(milliseconds, 1e3);
    // return fmtList.format([
    // //   days ? fmtDays(days) : null,
    //   hours ? fmtHours(hours) : null,
    //   minutes ? fmtMinutes(minutes) : null,
    //   seconds ? fmtSeconds(seconds) : null,
    // //   milliseconds ? fmtMilliseconds(milliseconds) : null
    // ].filter(v => v !== null));
    return [hours].concat([minutes, seconds].map(amt => amt.toString().padStart(2, '0'))).join(':');
  }
}

const formatDuration = createDurationFormatter('en-US', 'short');

tableButton.addEventListener('click', build_table);

async function build_timeline() {
    visDiv.replaceChildren();
    const timeDiv = visDiv.appendChild(document.createElement('div'));
    timeDiv.className = 'timeline';
    const data = await get_data();

    const chains = [];
    const idxInChains = {};
    for (const [id, row] of Object.entries(data)) {
        row.id = parseInt(id);
        if (row.begin !== undefined) {
            row.begin = new Date(row.begin);
        }
        if (row.end !== undefined) {
            row.end = new Date(row.end);
        }

        let newChainIdx;
        if (row.parent !== undefined && row.parent in idxInChains) {
            newChainIdx = idxInChains[row.parent];
            const chainArr = chains[newChainIdx];
            const insertAfter = chainArr.findIndex(element => element.id === row.parent);
            chainArr.splice(insertAfter + 1, 0, row);
        } else {
            newChainIdx = chains.length;
            chains.push([row]);
        }
        idxInChains[row.id] = newChainIdx;
    }

    chains.sort((lhs, rhs) => lhs.at(-1).begin - rhs.at(-1).begin);

    chains.findLast((chain) => {
        const chainDiv = timeDiv.appendChild(document.createElement('div'));
        const topP = chainDiv.appendChild(document.createElement('p'));
        const topPage = chain.at(-1);
        if (topPage.end === undefined) {
            topP.textContent = 'Currently Open';
        } else {
            topP.textContent = `Closed ${formatDate(topPage.end)}`;
        }
        chain.findLast((page) => {
            const pageP = chainDiv.appendChild(document.createElement('p'));
            const pageA = pageP.appendChild(document.createElement('a'));
            pageA.href = `https://en.wikipedia.org/wiki/${page.title}`;
            pageA.append(page.title);

            if (page.lat !== undefined && page.lon !== undefined) {
                const locA = pageP.appendChild(document.createElement('a'));
                locA.href = `https://www.google.com/maps/place/${page.lat},${page.lon}`;
                locA.target = '_blank';
                locA.rel = 'noopener noreferrer';
                locImg = locA.appendChild(document.createElement('img'));
                locImg.src = 'marker_64.png';
                locImg.height = '16';
            }

            if (page.end !== undefined) {
                pageP.append(`(Open for ${formatDuration(page.end - page.begin)})`);
            }

            return false;
        });
        const bottomPage = chain.at(0);
        const bottomP = chainDiv.appendChild(document.createElement('p'));
        bottomP.append(`Opened ${formatDate(bottomPage.begin)}`);
        return false;
    })
}
timelineButton.addEventListener('click', build_timeline);