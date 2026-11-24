(() => {
  "use strict";
  const data = window.EXCHANGE_ATLAS;
  if (!data || !Array.isArray(data.universities)) {
    const status = document.querySelector("#result-count");
    status.textContent = "Destination data could not be loaded.";
    return;
  }

  const $ = selector => document.querySelector(selector);
  const guides = window.EXCHANGE_ATLAS_GUIDES ?? {campuses:{}, countries:{}, careers:{}};
  const schools = new Map(data.universities.map(school => [school.id, school]));
  const markets = new Map(data.salaries.map(pay => [pay.market, pay]));
  const steps = 12;
  const keys = ["computing", "campus", "cost", "pay"];
  const weightsLabel = { computing:"Computing", campus:"Campus", cost:"Affordability", pay:"Career pay" };
  const presets = {
    balanced:[40, 30, 30, 0],
    technical:[55, 20, 25, 0],
    residential:[25, 55, 20, 0],
    budget:[30, 15, 55, 0],
    career:[40, 15, 15, 30]
  };
  const storageKey = "exchange-atlas:v1";
  const valid = value => typeof value === "number" && Number.isFinite(value);
  const allValid = values => values.every(valid);
  const valueOf = input => input.value === "" ? null : input.valueAsNumber;
  const rounded = value => Math.round((value + Number.EPSILON) * 10) / 10;
  const normalize = value => String(value ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const esc = value => String(value ?? "").replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));
  const external = (href, label) => /^https?:\/\//i.test(href ?? "") ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + '</a>' : "";
  const safeStorage = () => {
    try { return JSON.parse(localStorage.getItem(storageKey)) ?? {}; } catch { return {}; }
  };
  const remembered = safeStorage();
  const rememberedWeights = remembered.weights;
  const weightsValid = Array.isArray(rememberedWeights) && rememberedWeights.length === 4 &&
    rememberedWeights.every(value => valid(value) && value >= 0 && value <= 100) && rememberedWeights.some(value => value > 0);
  const state = {
    currency: remembered.currency === "local" ? "local" : "BRL",
    weights: weightsValid ? [...rememberedWeights] : [...presets.balanced],
    selection: Array.isArray(remembered.selection) ? [...new Set(remembered.selection)].filter(id => schools.has(id)).slice(0,3) : [],
    visible: steps,
    marketSort: "name",
    payPeriod: "annual",
    current: null,
    plannerId: null,
  };
  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({currency:state.currency, weights:state.weights, selection:state.selection}));
    } catch { /* Browsers may block file-origin storage. */ }
  }

  const fx = data.fx;
  function convert(amount, from, to) {
    return valid(amount) && fx[from] && fx[to] ? amount * fx[to] / fx[from] : null;
  }
  const bandIn = (low, high, from, to = "BRL") => [convert(low, from, to), convert(high, from, to)];
  const currencies = new Map();
  function money(amount, currency) {
    if (!valid(amount)) return "—";
    if (!currencies.has(currency)) currencies.set(currency,new Intl.NumberFormat("en-BR",{style:"currency",currency,currencyDisplay:currency==="BRL"?"narrowSymbol":"code",maximumFractionDigits:0}));
    return currencies.get(currency).format(amount);
  }
  function bandText([low,high], currency) {
    if (valid(low) && valid(high)) return money(low,currency) + (Math.round(low) === Math.round(high) ? "" : "–" + money(high,currency));
    if (valid(low)) return "From " + money(low,currency);
    if (valid(high)) return "Up to " + money(high,currency);
    return "Unavailable";
  }
  function scoreAxis(axes) {
    const count = axes.filter(valid).length;
    return count >= 3 ? (axes.reduce((total, value) => total + (value ?? 1), 0) / 8 * 10) : null;
  }
  const axisText = score => valid(score) ? rounded(score).toFixed(1) : "—";
  function payLabel(pay, currency) {
    if (!pay) return "Unavailable";
    if (valid(pay.point)) return money(convert(pay.point,pay.currency,currency),currency);
    return bandText(bandIn(pay.low,pay.high,pay.currency,currency),currency);
  }
  const levels = {junior:"Junior",mid:"Mid-level",senior:"Senior"};
  const settings = {metro:"Major metro",city:"Mid-sized city",town:"Small city or town"};
  const englishLabels = {confirmed:"Documented English offering",limited:"English options limited",unverified:"Teaching language to confirm"};
  const selectedLevel = () => $("#experience-filter").value;
  function levelBand(salary, level, currency, divisor=1) {
    const series = guides.careers[salary.market];
    return (series?.bands[level] ?? [null,null]).map(value => valid(value) ? convert(value/divisor,series.currency,currency) : null);
  }
  function levelValue(salary, level) {
    const [low,high] = levelBand(salary,level,"BRL");
    return allValid([low,high]) ? (low+high)/2 : low ?? high;
  }
  function selectedPayLabel(item) {
    const level = selectedLevel();
    return level ? bandText(levelBand(item.salary,level,payCurrency(item.salary)),payCurrency(item.salary)) : payLabel(item.salary,payCurrency(item.salary));
  }
  function housingCategory(school) {
    if (!valid(school.low) && !valid(school.high)) return "missing";
    if (/restrict|cap/i.test(school.housingType)) return "restricted";
    if (/university|public|^campus/i.test(school.housingType)) return "residence";
    return "estimate";
  }
  function livingBand(school, currency, rentOverride) {
    const housing = rentOverride ?? bandIn(school.low,school.high,school.housingCurrency,currency);
    const other = bandIn(school.living.low,school.living.high,school.living.currency,currency);
    return housing.map((value,index) => valid(value) && valid(other[index]) ? value + other[index] : null);
  }
  const index = data.universities.map(school => {
    const salary = markets.get(school.market);
    const rent = bandIn(school.low,school.high,school.housingCurrency);
    const budget = livingBand(school,"BRL");
    const payCentral = salary.point ?? (allValid([salary.low,salary.high]) ? (salary.low+salary.high)/2 : null);
    return {
      school, salary, rent, budget,
      guide:guides.campuses[school.id],
      campus:scoreAxis(school.campusAxes),
      computing:scoreAxis(school.techAxes),
      costSignal:allValid(budget) ? .4 * budget[0] + .6 * budget[1] : null,
      payBRL:convert(payCentral,salary.currency,"BRL"),
      payFloor:convert(salary.point ?? salary.low,salary.currency,"BRL"),
      housing:housingCategory(school),
      search:normalize([school.name,school.market,school.city,school.program].join(" "))
    };
  });

  function percentile(values, value, reverse = false) {
    if (!valid(value) || values.length < 2) return null;
    const below = values.filter(other => other < value).length;
    const equal = values.filter(other => other === value).length;
    const fraction = (below + (equal - 1) / 2) / (values.length - 1);
    return (reverse ? 1 - fraction : fraction) * 100;
  }
  const costValues = index.map(item => item.costSignal).filter(valid);
  const marketValues = [...new Map(index.map(item => [item.school.market,item.payBRL])).values()].filter(valid);
  const byId = new Map(index.map(item => {
    item.parts = [valid(item.computing) ? item.computing*10 : null, valid(item.campus) ? item.campus*10 : null,
      percentile(costValues,item.costSignal,true), percentile(marketValues,item.payBRL)];
    return [item.school.id,item];
  }));
  function fit(item) {
    const sum = state.weights.reduce((acc,weight) => acc+weight,0);
    const unknown = state.weights.some((weight,i) => weight > 0 && !valid(item.parts[i])) ||
      (state.weights[0] > 0 && item.school.techAxes.some(value => !valid(value))) ||
      (state.weights[1] > 0 && item.school.campusAxes.some(value => !valid(value))) ||
      (state.weights[3] > 0 && !valid(item.salary.point));
    if (!state.weights.some((weight,i) => weight > 0 && valid(item.parts[i]))) return { score:null, unknown:true };
    return { score:item.parts.reduce((total,part,i) => total+(part ?? 50)*state.weights[i],0)/sum, unknown };
  }
  const currencyFor = item => state.currency === "BRL" ? "BRL" : item.school.currency;
  const payCurrency = salary => state.currency === "BRL" ? "BRL" : salary.currency;
  const weightSummary = () => {
    const total = state.weights.reduce((sum,value)=>sum+value,0);
    return keys.map((key,i) => '<div class="weight-line"><span>' + weightsLabel[key] + '</span><b>' + Math.round(state.weights[i]/total*100) + '%</b></div>').join("");
  };
  const icons = {
    details:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8v1" stroke-linecap="round"/></svg>',
    photo:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="9" r="1.25"/><path d="m4 17 4-4 3 3 4-5 5 6" stroke-linejoin="round"/></svg>',
    add:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 12h14m-7-7v14" stroke-linecap="round"/></svg>',
    checked:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m5 12 5 5 9-10" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };
  function row(item) {
    const {school} = item;
    const currency = currencyFor(item);
    const budget = livingBand(school,currency);
    const total = fit(item);
    const chosen = state.selection.includes(school.id);
    const score = valid(total.score) ? Math.round(total.score) + (total.unknown ? "*" : "") : "—";
    const incomplete = !valid(budget[1]);
    const rentText = bandText(bandIn(school.low,school.high,school.housingCurrency,currency),currency);
    const language = item.guide?.english;
    return '<li class="destination" data-id="' + esc(school.id) + '">'
      + '<div class="identity"><div class="score-tile" aria-label="Overall fit ' + esc(score) + ' out of 100">' + esc(score) + '<small>FIT</small></div>'
      + '<div><h3>' + esc(school.name) + '</h3><p class="location">' + esc(school.displayCity) + ' · ' + esc(school.market) + '</p>'
      + '<div class="chips"><span class="chip">Campus ' + axisText(item.campus) + '</span><span class="chip">Computing ' + axisText(item.computing) + '</span>'
      + (language === "confirmed" ? '<span class="chip chip-language" title="Documented English-taught computing offering">English courses</span>' : '') + '</div></div></div>'
      + '<div class="metric"><span class="mobile-label">Living / month</span><strong>' + esc(bandText(budget,currency)) + '</strong><small>' + (incomplete ? "Upper estimate pending" : "Housing " + esc(rentText)) + '</small></div>'
      + '<div class="metric"><span class="mobile-label">Tech pay / year</span><strong>' + esc(selectedPayLabel(item)) + '</strong><small>' + (levels[selectedLevel()] ?? "Gross market reference") + '</small></div>'
      + '<div class="row-actions"><button type="button" class="row-button" data-details="' + esc(school.id) + '" aria-label="Details for ' + esc(school.name) + '" title="Campus images and university details">' + (item.guide?.photo ? icons.photo : icons.details) + '</button>'
      + '<button type="button" class="row-button" data-pick="' + esc(school.id) + '" aria-pressed="' + chosen + '" aria-label="Compare ' + esc(school.name) + '" title="Add or remove from comparison">' + (chosen?icons.checked:icons.add) + '</button></div></li>';
  }
  function filterValues() {
    const cap = valueOf($("#cap"));
    const rentCap = valueOf($("#rent-cap"));
    const pay = valueOf($("#pay-filter"));
    return {
      query:normalize($("#search").value.trim()),
      market:$("#market-filter").value,
      setting:$("#setting-filter").value,
      english:$("#english-filter").value,
      level:selectedLevel(),
      cap:valid(cap) && cap >= 0 ? cap : null,
      rentCap:valid(rentCap) && rentCap >= 0 ? rentCap : null,
      pay:valid(pay) && pay >= 0 ? pay : null,
      campus:$("#campus-filter").value === "" ? null : +$("#campus-filter").value,
      computing:$("#cs-filter").value === "" ? null : +$("#cs-filter").value,
      housing:$("#housing-filter").value,
      complete:$("#complete").checked
    };
  }
  function compareNumber(a,b,ascending=false) {
    if (!valid(a)) return valid(b) ? 1 : 0;
    if (!valid(b)) return -1;
    return ascending ? a-b : b-a;
  }
  const byName = (a,b) => a.school.name.localeCompare(b.school.name,"en");
  const sortRules = {
    fit:(a,b)=>compareNumber(a.fitScore,b.fitScore)||Number(a.provisional)-Number(b.provisional),
    cost:(a,b)=>compareNumber(a.budget[0],b.budget[0],true),
    "cost-high":(a,b)=>compareNumber(a.budget[1],b.budget[1],true),
    housing:(a,b)=>compareNumber(a.rent[0],b.rent[0],true),
    campus:(a,b)=>compareNumber(a.campus,b.campus),
    computing:(a,b)=>compareNumber(a.computing,b.computing),
    pay:(a,b)=>compareNumber(a.displayPay,b.displayPay),
    name:byName
  };
  function renderList() {
    const values = filterValues();
    $("#country-picks").querySelectorAll("[data-country]").forEach(button => {
      button.setAttribute("aria-pressed",String(button.dataset.country===values.market));
    });
    const count = Object.values(values).filter(value => value !== "" && value !== null && value !== false).length;
    $("#filter-count").textContent = count;
    $("#filter-count").hidden = count === 0;
    const terms = values.query.split(/\s+/).filter(Boolean);
    const list = index.filter(item => {
      const floor = values.level ? levelBand(item.salary,values.level,"BRL")[0] : item.payFloor;
      return terms.every(word=>item.search.includes(word)) &&
        (!values.market || values.market === item.school.market) &&
        (!values.setting || values.setting === item.guide?.setting) &&
        (!values.english || values.english === (item.guide?.english ?? "unverified")) &&
        (values.cap === null || valid(item.budget[1]) && item.budget[1] <= values.cap) &&
        (values.rentCap === null || valid(item.rent[1]) && item.rent[1] <= values.rentCap) &&
        (values.pay === null || valid(floor) && floor >= values.pay) &&
        (values.campus === null || valid(item.campus) && rounded(item.campus) >= values.campus) &&
        (values.computing === null || valid(item.computing) && rounded(item.computing) >= values.computing) &&
        (!values.housing || values.housing === item.housing) &&
        (!values.complete || allValid(item.budget));
    }).map(item => {
      const result = fit(item);
      return {...item,fitScore:result.score,provisional:result.unknown,displayPay:values.level ? levelValue(item.salary,values.level) : item.payBRL};
    });
    const sort = sortRules[$("#sort").value] ?? sortRules.fit;
    list.sort((a,b)=>sort(a,b)||byName(a,b));
    $("#results-list").innerHTML = list.slice(0,state.visible).map(row).join("");
    $("#result-count").textContent = list.length + (list.length === 1 ? " destination" : " destinations");
    $("#empty").hidden = list.length !== 0;
    $("#load-more").hidden = list.length <= state.visible;
    $("#load-more").textContent = "Show " + Math.min(steps,Math.max(0,list.length-state.visible)) + " more destinations";
    $("#rank-summary").innerHTML = weightSummary();
  }
  function renderMarkets() {
    const pay = [...markets.values()];
    pay.sort((a,b) => (state.marketSort==="pay" ? compareNumber(levelValue(a,"mid"),levelValue(b,"mid")) : 0) || a.market.localeCompare(b.market));
    document.querySelectorAll("[data-market-sort]").forEach(button => {
      const active=state.marketSort===button.dataset.marketSort;
      button.closest("th").setAttribute("aria-sort",active?(state.marketSort==="name"?"ascending":"descending"):"none");
    });
    $("#pay-table").innerHTML = pay.map(salary => {
      const currency = payCurrency(salary);
      const divisor = state.payPeriod === "monthly" ? 12 : 1;
      const rate = guides.careers[salary.market]?.freelance;
      return '<tr><th scope="row">' + esc(salary.market) + '</th>'
        + Object.keys(levels).map(level => '<td><strong>' + esc(bandText(levelBand(salary,level,currency,divisor),currency)) + '</strong></td>').join("")
        + '<td>' + esc(rateLabel(rate,currency)) + '</td><td><button type="button" class="button button-outline market-button" data-career="' + esc(salary.market) + '">View market</button></td></tr>';
    }).join("");
  }

  function renderCompareBar() {
    document.querySelectorAll("[data-compare-count]").forEach(element => element.textContent=state.selection.length);
    $("#compare-bar").hidden = state.selection.length === 0;
    $("#compare-choices").innerHTML = state.selection.map(id => {
      const s=schools.get(id);
      return '<button class="picked" type="button" data-pick="' + esc(id) + '" title="Remove ' + esc(s.name) + '" aria-label="Remove ' + esc(s.name) + ' from comparison">' + esc(s.name) + ' ×</button>';
    }).join("");
  }
  function togglePick(id,button) {
    if (!schools.has(id)) return;
    if (state.selection.includes(id)) state.selection=state.selection.filter(value=>value!==id);
    else if (state.selection.length < 3) state.selection.push(id);
    else {
      openDialog("compare",button,"Remove a university before adding a fourth.");
      return;
    }
    save();
    renderCompareBar();
    renderList();
    const replacement = document.querySelector('.destination [data-pick="' + CSS.escape(id) + '"]');
    if (dialog.open && state.current === "compare") openDialog("compare",null);
    else if (dialog.open && state.current === "details") {
      openDialog("details",null,id);
      dialog.querySelector("[data-pick]")?.focus();
    } else if (replacement) replacement.focus({preventScroll:true});
  }
  function setCurrency(currency) {
    if (currency !== "BRL" && currency !== "local") return;
    state.currency=currency;
    document.querySelectorAll("[data-currency]").forEach(el=>el.setAttribute("aria-pressed",String(el.dataset.currency===currency)));
    save(); renderList(); renderMarkets();
  }

  const dialog = $("#dialog");
  const content = $("#dialog-content");
  let returnFocus = null;
  function openDialog(mode, trigger, arg) {
    if (!dialog.open && trigger) returnFocus = trigger;
    state.current=mode;
    dialog.dataset.wide=String(mode==="compare" || mode==="details");
    if (mode==="details") showDetails(arg);
    if (mode==="method") showMethod();
    if (mode==="ranking") showRank();
    if (mode==="compare") showCompare(arg);
    if (mode==="planner") showPlanner(arg);
    if (mode==="career") showCareer(arg);
    if (!dialog.open) dialog.showModal();
    content.scrollTop=0;
    dialog.scrollTop=0;
  }
  dialog.addEventListener("close",() => {
    state.current=null;
    if (returnFocus?.isConnected) returnFocus.focus({preventScroll:true});
    else if (returnFocus?.dataset.details) document.querySelector('.destination [data-details="' + CSS.escape(returnFocus.dataset.details) + '"]')?.focus({preventScroll:true});
    else if (returnFocus?.dataset.pick) document.querySelector('.destination [data-pick="' + CSS.escape(returnFocus.dataset.pick) + '"]')?.focus({preventScroll:true});
    else $("#destinations-title").focus({preventScroll:true});
    returnFocus=null;
  });
  dialog.addEventListener("click",event=>{ if(event.target===dialog) dialog.close(); });
  const heading = value => $("#dialog-title").textContent = value;
  const tile = (label,value) => '<div class="detail-tile"><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>';
  const sources = links => '<div class="sources">' + links.map(([href,label])=>external(href,label)).join("") + '</div>';
  const section = (title,body,id) => '<section class="dialog-section"' + (id ? ' id="' + esc(id) + '"' : '') + '><h3 tabindex="-1">' + esc(title) + '</h3>' + body + '</section>';
  const p = value => value ? '<p>' + esc(value) + '</p>' : "";
  const detailRow = (label, value) => '<tr><th scope="row">' + esc(label) + '</th><td>' + esc(value) + '</td></tr>';
  const detailTable = rows => '<table class="detail-table"><tbody>' + rows.map(([label,value])=>detailRow(label,value)).join("") + '</tbody></table>';
  function campusPhoto(guide) {
    const photo = guide?.photo;
    const gallery = external(guide?.gallery,"University gallery or campus tour");
    if (!photo) return gallery ? '<div class="campus-photo-link"><span>Campus images</span>' + gallery + '</div>' : "";
    return '<figure class="campus-photo"><img src="' + esc(photo.src) + '" alt="' + esc(photo.caption) + '" width="' + esc(photo.width) + '" height="' + esc(photo.height) + '" decoding="async">'
      + '<figcaption><span>' + esc(photo.caption) + '</span><span>'
      + external(photo.source, photo.author || "Original photo") + " · "
      + (photo.licenseUrl ? external(photo.licenseUrl,photo.license) : esc(photo.license)) + (gallery ? " · " + gallery : "") + '</span></figcaption></figure>';
  }
  function destinationGuide(school,guide) {
    if (!guide) return "";
    const country = guides.countries[school.market];
    const entries = [["Daily life",guide.city],["Food to try",guide.food],["Things to do",guide.activities],["Getting around",guide.transit]];
    return section("Living in " + school.displayCity,
      '<div class="city-guide-grid">' + entries.map(([label,value])=>'<div><h4>'+esc(label)+'</h4>'+p(value)+'</div>').join("") + '</div>'
      + sources([[guide.visitUrl,"Official visitor guide"],[guide.visitExtra,"More local information"]])
      + (country ? '<details class="country-guide"><summary>Life in ' + esc(school.market) + '</summary>' + p(country.note) + sources([[country.url,"Country guide"]]) + '</details>' : ""), "city-guide");
  }
  function rateLabel(rate,currency) {
    return rate?.unit && (valid(rate.low) || valid(rate.high))
      ? bandText(bandIn(rate.low,rate.high,rate.currency,currency),currency) + " / " + rate.unit
      : "No verified local rate";
  }
  function careerPayRows(salary,currency) {
    return Object.entries(levels).map(([key,label])=>[label + " gross / year",bandText(levelBand(salary,key,currency),currency)]);
  }
  function showCareer(market) {
    const salary = markets.get(market);
    const career = guides.careers[market];
    if (!salary || !career) return;
    const currency = payCurrency(salary);
    const rate = career.freelance;
    const contractCurrency = rate.currency || career.currency;
    heading(market + " · Career market");
    content.innerHTML =
      '<p class="dialog-intro">Software career benchmarks and an independent-work estimate.</p>'
      + '<dl class="detail-metrics career-bands">' + Object.keys(levels).map(level=>tile(levels[level]+" gross / year",bandText(levelBand(salary,level,currency),currency))).join("") + '</dl>'
      + section("Salary evidence",p(career.salaryNote) + sources([[career.salaryUrl,"Salary study"],[career.salaryExtra,"Additional salary source"]])
        + detailTable([["Broad market reference / year",payLabel(salary,currency)]]) + sources([[salary.url,"Broad market benchmark"]]))
      + section("Freelance work",detailTable([["Observed billing benchmark",rateLabel(rate,currency)]]) + p(rate.note)
        + sources([[rate.url,"Freelance rate source"],[rate.extra,"Additional contract benchmarks"]])
        + '<p class="freelance-ideas">Potential portfolio offers include landing pages, maintenance and integrations, and workflow automation. Scope each project and allow for unpaid sales and admin time.</p>')
      + section("Work authorization during exchange",p(career.workNote)
        + p("Confirm your exact immigration status, contracting and invoicing requirements before accepting paid work, including remote work for clients abroad.")
        + sources([[career.visaUrl,"Official work rules"],[career.visaExtra,"Additional official guidance"]]))
      + section("Estimate contracts",p("Enter a rate and billable units for one month. The estimate shows revenue and what remains after the business costs you enter, before income tax.")
        + '<form id="freelance-form"><div class="form-grid"><label>Billing unit<select id="freelance-unit"><option value="hour">Hour</option><option value="day">Day</option></select></label>'
        + '<label>Rate ('+esc(contractCurrency)+')<input id="freelance-rate" type="number" min="0" max="100000" step="any" value="0" required></label>'
        + '<label><span id="freelance-units-label">Billable hours / month</span><input id="freelance-units" type="number" min="0" max="744" step="any" value="0" required></label>'
        + '<label>Business costs (%)<input id="freelance-cost" type="number" min="0" max="100" step="any" value="0" required></label></div>'
        + (rate.unit && valid(rate.low) ? '<button class="button button-outline" id="use-rate" type="button">Use published reference</button>' : '')
        + '</form><div id="freelance-results" aria-live="polite"></div>');
    const form = $("#freelance-form");
    const unit = $("#freelance-unit");
    const amount = $("#freelance-rate");
    const units = $("#freelance-units");
    const costs = $("#freelance-cost");
    unit.value = rate.unit ?? "hour";
    const calculate = () => {
      const day = unit.value === "day";
      $("#freelance-units-label").textContent = day ? "Billable days / month" : "Billable hours / month";
      units.max = day ? "31" : "744";
      const results = $("#freelance-results");
      if (!form.checkValidity()) {
        results.innerHTML = '<p class="status-text error-text">Enter values within the displayed limits.</p>';
        return;
      }
      const total = amount.valueAsNumber * units.valueAsNumber;
      const afterCosts = total * (1-costs.valueAsNumber/100);
      results.innerHTML = '<dl class="budget-totals freelance-totals">' + tile("Billed per month",money(convert(total,contractCurrency,currency),currency))
        + tile("After expenses, before tax",money(convert(afterCosts,contractCurrency,currency),currency)) + '</dl>';
    };
    unit.addEventListener("input",()=>{ amount.value="0"; units.value="0"; });
    form.addEventListener("input",calculate);
    form.addEventListener("submit",event=>event.preventDefault());
    $("#use-rate")?.addEventListener("click",()=>{
      if (unit.value!==rate.unit) units.value="0";
      unit.value=rate.unit;
      amount.value=rate.low;
      calculate();
    });
    calculate();
  }
  function showDetails(id) {
    const item = byId.get(id);
    if (!item) return;
    const {school, salary, guide} = item;
    heading(school.name);
    const currency = currencyFor(item);
    const localRent = bandIn(school.low,school.high,school.housingCurrency,currency);
    const nonHousing = bandIn(school.living.low,school.living.high,school.living.currency,currency);
    const cost = livingBand(school,currency);
    const grossMonth = valid(salary.point) ? payLabel({...salary,point:salary.point/12},payCurrency(salary)) :
      bandText(bandIn(valid(salary.low)?salary.low/12:null,valid(salary.high)?salary.high/12:null,salary.currency,payCurrency(salary)),payCurrency(salary));
    const grossRange = bandText(bandIn(salary.low,salary.high,salary.currency,payCurrency(salary)),payCurrency(salary));
    const payRows = [...careerPayRows(salary,payCurrency(salary)),["Broad benchmark / year",payLabel(salary,payCurrency(salary))],["Broad benchmark / month",grossMonth],["Published broad band",grossRange]];
    const chosen = state.selection.includes(id);
    const rank = fit(item);
    const axisRows = [["Computing fundamentals",school.techAxes[0]],["Advanced computing",school.techAxes[1]],["Applied work",school.techAxes[2]],["Research",school.techAxes[3]],["Residential life",school.campusAxes[0]],["Sports",school.campusAxes[1]],["Student organizations",school.campusAxes[2]],["Campus spaces",school.campusAxes[3]]]
      .map(([label,value])=>[label,valid(value)?value+" / 2":"Evidence gap"]);
    content.innerHTML = '<p class="dialog-intro">' + esc(school.city) + ' · ' + esc(school.market) + '</p>'
      + '<nav class="guide-links" aria-label="University guide sections"><button type="button" data-jump="city-guide">City guide</button><button type="button" data-jump="living-guide">Living costs</button><button type="button" data-jump="tech-guide">Tech salaries</button></nav>'
      + campusPhoto(guide)
      + '<dl class="detail-metrics">' + tile("Overall fit",valid(rank.score)?Math.round(rank.score)+" / 100"+(rank.unknown?" (provisional)":""):"Unavailable")
      + tile("Computing",axisText(item.computing)+" / 10") + tile("Campus",axisText(item.campus)+" / 10") + tile("Total living / month",bandText(cost,currency)) + '</dl>'
      + '<div class="dialog-actions"><button type="button" class="button button-primary" data-plan="' + esc(id) + '">Plan this budget</button><button type="button" class="button button-outline" data-pick="' + esc(id) + '">' + (chosen?"Remove from comparison":"Add to comparison") + '</button></div>'
      + destinationGuide(school,guide)
      + section("Monthly living budget",detailTable([["Housing",bandText(localRent,currency)],["Food, transport and basics",bandText(nonHousing,currency)],["Estimated total",bandText(cost,currency)]])
        + p(school.housingType + ". " + school.housingEvidence) + sources([[school.housingUrl,"Housing source"],[school.housingExtra,"Additional housing evidence"]])
        + p(school.living.level + " basis. " + school.living.note) + sources([[school.living.url,"Living-cost source"],[school.living.extra,"Additional cost evidence"]]), "living-guide")
      + section("Tech pay in " + school.market,detailTable(payRows)
        + p(guides.careers[school.market]?.salaryNote) + sources([[guides.careers[school.market]?.salaryUrl,"Experience-level salary source"],[salary.url,"Broad salary source"]])
        + '<div class="dialog-actions"><button type="button" class="button button-outline" data-career="' + esc(school.market) + '">Freelance and work rules</button></div>', "tech-guide")
      + section("Computing and campus",p(school.program) + p(school.techEvidence) + sources([[school.techUrl,"Computing evidence"],[school.techExtra,"Additional computing source"]])
        + p((englishLabels[guide?.english] ?? "Teaching language to confirm") + ". " + (guide?.englishNote ?? "")) + sources([[guide?.englishUrl,"Course language evidence"]])
        + p(school.campusEvidence) + sources([[school.campusUrl,"Campus evidence"],[school.campusExtra,"Additional campus evidence"]])
        + '<details><summary>Rating breakdown and fit inputs</summary>' + detailTable(axisRows) + detailTable(keys.map((k,i)=>[weightsLabel[k] + " fit input",valid(item.parts[i])?rounded(item.parts[i])+" / 100":"Evidence gap"])) + '</details>')
      + (school.exchangeNote?section("Exchange notes",p(school.exchangeNote)):"");
  }

  function showMethod() {
    heading("How to read Exchange Atlas");
    content.innerHTML = '<p class="dialog-intro">Use the directory to shortlist destinations and the planner to estimate funding for a specific stay.</p>'
      + section("Overall fit",p("Default weights are 40% Computing, 30% Campus and 30% Affordability. Career pay is optional. Weights are normalized to 100%. Lower costs earn a higher affordability percentile using 40% of the low estimate and 60% of the high estimate. The ranking uses one broad pay benchmark per country. The reference set stays fixed while filters change.")
        + p("A missing weighted component receives a neutral 50/100 and marks the score with an asterisk. A missing campus or computing axis receives 1/2 when the other three are documented. At least three axes are required to publish either underlying score."))
      + section("Living cost",p("Monthly living estimates combine the documented housing amount with a low–high allowance for food, local transport and essentials. Campus or city evidence is preferred. Regional and national planning ranges are marked where finer figures are unavailable. Low and high endpoints are scenarios, not hard limits. Budget exclusions and exceptions are shown by destination. Add airfare, visa, tuition, insurance and other extras in the planner as applicable."))
      + section("Sources and currency",p("University and salary evidence was reviewed in November 2026. Currency conversions use UN Treasury operating rates from 15 November 2026. Market estimates retain their source periods and can differ in seniority, sample and pay definition.")
        + p("The experience filter uses the published lower endpoint for its pay floor and the midpoint for sorting ranges. Monthly salary views divide annual gross amounts by 12. City settings are editorial classifications. English-course evidence may apply to specific programs, mobility agreements or terms.")
        + sources([["https://treasury.un.org/operationalrates/xsqlExRates.php","UN Treasury FX"],["https://unifor.br/dri/aluno","Unifor exchange support"],["https://unifor.br/web/graduacao/ciencia-da-computacao","Unifor Computer Science"]]))
      + section("Earnings during exchange",p("Professional salary benchmarks describe gross local pay. The planner starts with no employment income. If your exchange conditions permit work, enter your own hourly wage, authorized hours and estimated deductions. Take-home and funding-gap figures are projections based on those inputs. Consult the appropriate host authority for work eligibility."));
  }
  function showRank() {
    heading("Customize ranking");
    content.innerHTML = '<p class="dialog-intro">Choose a preset or enter a weight from 0 to 100. The university order updates after you apply the weights.</p>'
      + '<div class="presets" aria-label="Ranking presets">' + [["balanced","Balanced"],["technical","Computing first"],["residential","Campus first"],["budget","Budget first"],["career","Career market"]].map(([key,label])=>'<button class="button button-outline" type="button" data-preset="'+key+'">'+label+'</button>').join("") + '</div>'
      + '<form id="rank-form"><div class="rank-fields">' + keys.map((key,i)=>'<label>' + weightsLabel[key] + '<input name="' + key + '" type="number" min="0" max="100" step="1" required value="' + state.weights[i] + '"></label>').join("") + '</div>'
      + '<p class="field-note">Affordability uses the estimated monthly living range. Career pay uses the market’s gross benchmark.</p><p id="rank-error" class="status-text error-text" role="alert" hidden>Enter a positive weight for at least one criterion.</p>'
      + '<div class="dialog-actions"><button class="button button-primary">Apply weights</button></div></form>';
    $("#rank-form").addEventListener("submit",event=>{
      event.preventDefault();
      const weights=keys.map(key=>event.currentTarget.elements.namedItem(key).valueAsNumber);
      if (!weights.every(valid) || weights.every(value=>value===0)) { $("#rank-error").hidden=false; return; }
      state.weights=weights;
      $("#sort").value="fit";
      state.visible=steps;
      save(); renderList(); dialog.close();
    });
    content.querySelectorAll("[data-preset]").forEach(button=>button.addEventListener("click",()=>{
      const fields=$("#rank-form").elements;
      presets[button.dataset.preset].forEach((value,i)=>fields.namedItem(keys[i]).value=value);
      $("#rank-error").hidden=true;
    }));
  }

  function showCompare(message) {
    heading("Compare universities");
    if (state.selection.length===0) {
      content.innerHTML='<p class="dialog-intro">Use the plus buttons in the directory to select up to three universities.</p><form method="dialog"><button class="button button-primary">Back to destinations</button></form>';
      return;
    }
    const items=state.selection.map(id=>byId.get(id));
    const rows=[
      ["Location",item=>item.school.displayCity+" · "+item.school.market],
      ["Overall fit",item=>valid(fit(item).score)?Math.round(fit(item).score)+" / 100"+(fit(item).unknown?"*":""):"—"],
      ["Campus",item=>axisText(item.campus)+" / 10"],
      ["Computing",item=>axisText(item.computing)+" / 10"],
      ["Living / month",item=>bandText(livingBand(item.school,currencyFor(item)),currencyFor(item))],
      ["Housing / month",item=>bandText(bandIn(item.school.low,item.school.high,item.school.housingCurrency,currencyFor(item)),currencyFor(item))],
      ["Housing basis",item=>item.school.housingType],
      ["Gross tech pay / year",item=>payLabel(item.salary,payCurrency(item.salary))],
      ["Computing program",item=>item.school.program]
    ];
    content.innerHTML = (message?'<p class="dialog-intro" role="status">'+esc(message)+'</p>':'<p class="dialog-intro">Compare the same criteria across your shortlist. Select a university for its evidence and budget.</p>')
      + '<div class="table-scroll compare-inner" tabindex="0"><table><thead><tr><th scope="col">Criteria</th>'
      + items.map(item=>'<th scope="col"><button type="button" data-details="'+esc(item.school.id)+'">'+esc(item.school.name)+'</button></th>').join("")+'</tr></thead><tbody>'
      + rows.map(([label,value])=>'<tr><th scope="row">'+esc(label)+'</th>'+items.map(item=>'<td>'+esc(value(item))+'</td>').join("")+'</tr>').join("")
      + '<tr><th scope="row">Shortlist</th>'+items.map(item=>'<td><button class="button button-outline" type="button" data-pick="'+esc(item.school.id)+'">Remove</button></td>').join("")+'</tr></tbody></table></div>';
  }

  function showPlanner(id) {
    const selected = schools.has(id) ? id : schools.has(state.plannerId) ? state.plannerId : data.universities[0].id;
    heading("Exchange budget planner");
    content.innerHTML = '<p class="dialog-intro">Estimate the amount to set aside for a specific duration. Enter one-off and extra monthly costs in BRL.</p>'
      + '<form id="planner-form"><div class="form-grid"><label class="span">University<select id="plan-school">'
      + [...schools.values()].sort((a,b)=>a.name.localeCompare(b.name)).map(s=>'<option value="'+esc(s.id)+'" '+(s.id===selected?"selected":"")+'>'+esc(s.name+" · "+s.market)+'</option>').join("")
      + '</select></label><label>Months abroad<input id="plan-months" type="number" min="1" max="36" step=".5" value="5" required></label>'
      + '<label>One-off costs (R$)<input id="plan-setup" type="number" min="0" max="1000000" step="any" value="0"></label>'
      + '<label>Extra monthly costs (R$)<input id="plan-extra" type="number" min="0" max="100000" step="any" value="0"></label>'
      + '<label>Override housing / month (R$)<input id="plan-rent" type="number" min="0" max="100000" step="any" placeholder="Use published range"></label>'
      + '<label class="check span"><input id="plan-work" type="checkbox"> Include a work scenario if my exchange permits it</label>'
      + '<div class="form-grid span" id="work-fields" hidden><label><span>Hourly gross pay (<span id="rate-ccy"></span>)</span><input id="plan-rate" type="number" min="0" max="100000000" step="any" value="0"></label>'
      + '<label>Paid hours per week<input id="plan-hours" type="number" min="0" max="168" step=".25" value="0"></label><label>Estimated deductions (%)<input id="plan-tax" type="number" min="0" max="100" step=".1" value="0"></label>'
      + '<label>Months of paid work<input id="plan-work-months" type="number" min="0" max="36" step=".5" placeholder="Same as months abroad"></label>'
      + '<p class="field-note span">Use the hours your status permits. These inputs are yours to verify and are stored only while this planner is open.</p></div></div></form>'
      + '<div id="planner-results" aria-live="polite"></div>';
    const form=$("#planner-form");
    const calculate = () => {
      const u=schools.get($("#plan-school").value);
      state.plannerId=u.id;
      const worker = $("#plan-work").checked;
      $("#work-fields").hidden=!worker;
      $("#work-fields").querySelectorAll("input").forEach(input => input.disabled=!worker);
      $("#rate-ccy").textContent=u.currency;
      const results=$("#planner-results");
      const months=valueOf($("#plan-months"));
      const amount = selector => valueOf($(selector)) ?? 0;
      const workMonths = valueOf($("#plan-work-months")) ?? months;
      const override = valueOf($("#plan-rent"));
      if (!form.checkValidity() || !valid(months) || worker && workMonths>months) {
        results.innerHTML='<p class="status-text error-text">Enter values within the displayed limits. Months of paid work cannot exceed months abroad.</p>';
        return;
      }
      const range = livingBand(u,"BRL",valid(override)?[override,override]:undefined);
      const expenses = range.map(value=>valid(value)?(value+amount("#plan-extra"))*months+amount("#plan-setup"):null);
      const grossMonthly = worker ? convert(amount("#plan-rate") * amount("#plan-hours") * 52/12,u.currency,"BRL") : 0;
      const netTerm = grossMonthly * (1-(worker?amount("#plan-tax"):0)/100) * (worker?workMonths:0);
      const funding = expenses.map(value=>valid(value)?Math.max(0,value-netTerm):null);
      const surplus = expenses.map(value=>valid(value)?Math.max(0,netTerm-value):null).reverse();
      results.innerHTML='<dl class="budget-totals">'
        + tile("Living expenses for stay",bandText(expenses,"BRL"))
        + tile("Gross pay / working month",money(grossMonthly,"BRL"))
        + tile("Estimated take-home for stay",money(netTerm,"BRL"))
        + tile("Amount to budget after pay",bandText(funding,"BRL")) + '</dl>'
        + (surplus.some(value=>value>0)?'<p class="status-text">Potential surplus after the listed expenses ' + esc(bandText(surplus,"BRL")) + '.</p>':"")
        + (!allValid(expenses)?'<p class="status-text">Enter a monthly housing quote to complete this budget where a published endpoint is missing.</p>':"")
        + '<p class="status-text">A breakdown of the base estimate is available in the university details.</p>'
        + '<div class="dialog-actions"><button type="button" class="button button-outline" data-details="'+esc(u.id)+'">View cost sources</button></div>';
    };
    $("#plan-school").addEventListener("input",()=>{
      $("#plan-rate").value="0";
      $("#plan-rent").value="";
    });
    form.addEventListener("submit",event=>event.preventDefault());
    form.addEventListener("input",calculate);
    calculate();
  }

  document.addEventListener("click",event => {
    const button=event.target.closest("button");
    if (!button) return;
    if (button.dataset.currency) setCurrency(button.dataset.currency);
    if (button.hasAttribute("data-country")) {
      $("#market-filter").value=button.dataset.country;
      refresh();
    }
    if (button.dataset.payPeriod) {
      state.payPeriod=button.dataset.payPeriod;
      document.querySelectorAll("[data-pay-period]").forEach(element=>element.setAttribute("aria-pressed",String(element.dataset.payPeriod===state.payPeriod)));
      renderMarkets();
    }
    if (button.dataset.open) openDialog(button.dataset.open,button);
    if (button.dataset.details) openDialog("details",button,button.dataset.details);
    if (button.dataset.pick) togglePick(button.dataset.pick,button);
    if (button.dataset.plan) openDialog("planner",button,button.dataset.plan);
    if (button.dataset.career) openDialog("career",button,button.dataset.career);
    if (button.dataset.jump) {
      const target = content.querySelector("#" + CSS.escape(button.dataset.jump));
      target?.scrollIntoView({block:"start"});
      target?.querySelector("h3").focus({preventScroll:true});
    }
    if (button.dataset.marketSort) { state.marketSort=button.dataset.marketSort; renderMarkets(); }
  });
  const filters=$("#filters");
  const refresh=()=>{ state.visible=steps; renderList(); };
  filters.addEventListener("submit",event=>event.preventDefault());
  filters.addEventListener("input",refresh);
  filters.addEventListener("reset",()=>setTimeout(refresh,0));
  $("#clear-empty").addEventListener("click",()=>filters.reset());
  $("#sort").addEventListener("change",refresh);
  $("#load-more").addEventListener("click",()=>{
    const firstNew=state.visible;
    state.visible+=steps;
    renderList();
    $("#results-list").children[firstNew]?.querySelector("[data-details]")?.focus({preventScroll:true});
  });
  const filterBox=$(".filters");
  if (matchMedia("(max-width: 740px)").matches) filterBox.open=false;
  const marketOptions=[...markets.keys()].sort((a,b)=>a.localeCompare(b,"en"));
  $("#market-filter").firstElementChild.textContent="All eight countries";
  $("#market-filter").insertAdjacentHTML("beforeend",marketOptions.map(market=>'<option value="'+esc(market)+'">'+esc(market)+'</option>').join(""));
  const countryCounts = new Map();
  for (const school of schools.values()) countryCounts.set(school.market,(countryCounts.get(school.market) ?? 0)+1);
  $("#country-picks").innerHTML = [["","All countries",schools.size],...marketOptions.map(market=>[market,market,countryCounts.get(market)])]
    .map(([id,label,total])=>'<button class="country-pick" type="button" data-country="'+esc(id)+'" aria-pressed="false">'+esc(label)+' <span>'+total+'</span></button>').join("");
  $("#school-count").textContent=schools.size;
  $("#market-count").textContent=markets.size;
  $("#budget-count").textContent=index.filter(item=>allValid(item.budget)).length;
  renderCompareBar();
  setCurrency(state.currency);
})();
