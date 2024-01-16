const loadingDiv = document.querySelector('#loading');
const loadedDiv = document.querySelector('#loaded');
const visDiv = document.querySelector('#visualize');
const downloadAnchor = document.querySelector('#download');
const openAnchor = document.querySelector('#open');
const tableButton = document.querySelector('#table');

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
            tr.insertCell().innerText = (col_name in row) ? row[col_name] : '';
        }
    }
    visDiv.appendChild(table);
}

tableButton.addEventListener('click', build_table);