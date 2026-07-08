// ============================================================
// DP CONSTRUCTION GROUP — PAYROLL & HR SYSTEM
// Single-page app, Firebase Firestore + Auth backend.
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
  deleteDoc, query, where, orderBy, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseApp = initializeApp(window.firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

// ------------------------------------------------------------
// Small utilities
// ------------------------------------------------------------
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const view = () => $("#view");
const esc = (s) => (s ?? "").toString().replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const R = (n) => "R " + (Number(n)||0).toLocaleString('en-ZA', {minimumFractionDigits:2, maximumFractionDigits:2});
const todayISO = () => new Date().toISOString().slice(0,10);
const currentPeriod = () => new Date().toISOString().slice(0,7); // YYYY-MM
function monthLabel(period){
  if(!period) return "";
  const [y,m] = period.split("-");
  const d = new Date(Number(y), Number(m)-1, 1);
  return d.toLocaleDateString('en-ZA', {month:'long', year:'numeric'});
}

function toast(msg, isErr=false){
  const wrap = $("#toast-wrap");
  const t = document.createElement("div");
  t.className = "toast" + (isErr ? " err" : "");
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(()=>{ t.style.opacity="0"; t.style.transition="opacity .3s"; setTimeout(()=>t.remove(),300); }, 3200);
}

function openModal(html){
  const root = $("#modal-root");
  root.innerHTML = `<div class="modal-bg" id="modal-bg"><div class="modal">${html}</div></div>`;
  $("#modal-bg").addEventListener("click", (e)=>{ if(e.target.id==="modal-bg") closeModal(); });
}
function closeModal(){ $("#modal-root").innerHTML = ""; }
window.closeModal = closeModal;

// ------------------------------------------------------------
// Payroll math — SARS 2026/2027 tax year (1 Mar 2026 – 28 Feb 2027)
// This is a simplified, good-faith estimate for small-business use.
// Always reconcile against SARS's official tax deduction tables
// and check with your accountant/tax practitioner before filing.
// ------------------------------------------------------------
const TAX_YEAR_LABEL = "2026/2027 tax year (1 Mar 2026 – 28 Feb 2027)";
const BRACKETS = [
  {upTo:245100,    rate:0.18, base:0},
  {upTo:383100,    rate:0.26, base:44118},
  {upTo:530200,    rate:0.31, base:79998},
  {upTo:695800,    rate:0.36, base:125599},
  {upTo:887000,    rate:0.39, base:185215},
  {upTo:1878600,   rate:0.41, base:259783},
  {upTo:Infinity,  rate:0.45, base:666339},
];
const BRACKET_FLOORS = [0,245100,383100,530200,695800,887000,1878600];
const REBATES = { under65:17820, age65to74:27585, age75plus:30834 };
const UIF_CEILING_MONTHLY = 17712;
const UIF_RATE = 0.01;
const UIF_MAX_MONTHLY = 177.12;

function annualTax(annualTaxable){
  if(annualTaxable <= 0) return 0;
  for(let i=0;i<BRACKETS.length;i++){
    if(annualTaxable <= BRACKETS[i].upTo){
      return BRACKETS[i].base + BRACKETS[i].rate * (annualTaxable - BRACKET_FLOORS[i]);
    }
  }
  return 0;
}
function calcMonthlyPAYE(monthlyGross, ageBand='under65'){
  const annual = Math.max(0, monthlyGross) * 12;
  const tax = annualTax(annual);
  const rebate = REBATES[ageBand] ?? REBATES.under65;
  const annualPAYE = Math.max(0, tax - rebate);
  return Math.round((annualPAYE/12) * 100) / 100;
}
function calcUIF(monthlyGross){
  const capped = Math.min(Math.max(0,monthlyGross), UIF_CEILING_MONTHLY);
  return Math.round(Math.min(capped*UIF_RATE, UIF_MAX_MONTHLY) * 100) / 100;
}

function computeEarnings(emp, ts){
  ts = ts || {};
  let normalPay=0, otPay=0, sundayPay=0, unpaidDeduction=0;
  const overtimeHours = Number(ts.overtimeHours)||0;
  const sundayHours = Number(ts.sundayHours)||0;

  if(emp.payType === 'monthly'){
    normalPay = Number(emp.rate)||0;
    const unpaidDays = Number(ts.unpaidLeaveDays)||0;
    const dailyEquiv = normalPay/21.67;
    unpaidDeduction = dailyEquiv*unpaidDays;
    const hourlyEquiv = normalPay/(21.67*9);
    otPay = overtimeHours*hourlyEquiv*1.5;
    sundayPay = sundayHours*hourlyEquiv*2;
  } else if(emp.payType === 'daily'){
    const daysWorked = Number(ts.daysWorked)||0;
    normalPay = (Number(emp.rate)||0) * daysWorked;
    const hourlyEquiv = (Number(emp.rate)||0)/9;
    otPay = overtimeHours*hourlyEquiv*1.5;
    sundayPay = sundayHours*hourlyEquiv*2;
  } else { // hourly
    const normalHours = Number(ts.normalHours)||0;
    normalPay = (Number(emp.rate)||0) * normalHours;
    otPay = overtimeHours*(Number(emp.rate)||0)*1.5;
    sundayPay = sundayHours*(Number(emp.rate)||0)*2;
  }
  const allowances = Number(ts.allowances)||0;
  const bonuses = Number(ts.bonuses)||0;
  const gross = Math.max(0, normalPay+otPay+sundayPay+allowances+bonuses-unpaidDeduction);
  return {normalPay, otPay, sundayPay, allowances, bonuses, unpaidDeduction, gross};
}

// ------------------------------------------------------------
// Firestore helpers
// ------------------------------------------------------------
const col = (name) => collection(db, name);
async function getAllDocs(name, sortField){
  const snap = await getDocs(col(name));
  let rows = snap.docs.map(d=>({id:d.id, ...d.data()}));
  if(sortField) rows.sort((a,b)=> (a[sortField]>b[sortField]?1:-1));
  return rows;
}
async function nextSequence(counterName, prefix, pad=4){
  const ref = doc(db, "counters", counterName);
  const n = await runTransaction(db, async (tx)=>{
    const snap = await tx.get(ref);
    const cur = snap.exists() ? (snap.data().value||0) : 0;
    const next = cur+1;
    tx.set(ref, {value: next}, {merge:true});
    return next;
  });
  return `${prefix}-${String(n).padStart(pad,'0')}`;
}

// ------------------------------------------------------------
// Global cached state
// ------------------------------------------------------------
const State = {
  company: { name:"DP Construction Group", regNo:"", address:"", phone:"", email:"", logoDataUrl:"" },
  employees: [],
  currentUserEmail: "",
};

async function loadCompany(){
  try{
    const ref = doc(db, "settings", "company");
    const snap = await getDoc(ref);
    if(snap.exists()){
      State.company = {...State.company, ...snap.data()};
    } else if(window.companyDefaults){
      State.company = {...State.company, ...window.companyDefaults};
    }
  }catch(e){ console.error(e); }
  $("#brand-name").textContent = State.company.name || "DP Construction Group";
}
async function loadEmployees(){
  State.employees = await getAllDocs("employees", "empNo");
}
function empById(id){ return State.employees.find(e=>e.id===id); }

// ------------------------------------------------------------
// Auth
// ------------------------------------------------------------
const Auth = {
  async login(){
    const email = $("#login-email").value.trim();
    const pass = $("#login-pass").value;
    const errBox = $("#login-error");
    errBox.style.display = "none";
    if(!email || !pass){ errBox.textContent="Enter your email and password."; errBox.style.display="block"; return; }
    try{
      await signInWithEmailAndPassword(auth, email, pass);
    }catch(e){
      errBox.textContent = "Sign-in failed — check your email/password. (" + e.code + ")";
      errBox.style.display = "block";
    }
  },
  async logout(){ await signOut(auth); }
};
window.Auth = Auth;

onAuthStateChanged(auth, async (user)=>{
  if(user){
    $("#login-screen").classList.add("hidden");
    $("#app").classList.remove("hidden");
    $("#user-email").textContent = user.email;
    State.currentUserEmail = user.email;
    await loadCompany();
    await loadEmployees();
    Nav.render();
    Router.go("dashboard");
  } else {
    $("#login-screen").classList.remove("hidden");
    $("#app").classList.add("hidden");
  }
});

// ------------------------------------------------------------
// Navigation / Router
// ------------------------------------------------------------
const NAV_ITEMS = [
  {id:"dashboard", label:"Dashboard"},
  {id:"employees", label:"Employees"},
  {id:"timesheets", label:"Timesheets"},
  {id:"leave", label:"Leave Register"},
  {id:"payroll", label:"Run Payroll"},
  {id:"payslips", label:"Payslips"},
  {id:"reports", label:"Payroll Summary"},
  {id:"settings", label:"Company Settings"},
];
const Nav = {
  render(){
    const wrap = $("#nav");
    wrap.innerHTML = NAV_ITEMS.map(it=>`
      <button class="navbtn" data-nav="${it.id}"><span class="dot"></span>${esc(it.label)}</button>
    `).join("");
    $$("[data-nav]", wrap).forEach(b=>{
      b.addEventListener("click", ()=>Router.go(b.dataset.nav));
    });
  },
  setActive(id){
    $$("[data-nav]").forEach(b=> b.classList.toggle("active", b.dataset.nav===id));
  }
};
const Router = {
  current:"dashboard",
  async go(id){
    this.current = id;
    Nav.setActive(id);
    $("#view-title").textContent = NAV_ITEMS.find(n=>n.id===id)?.label || "";
    $("#view-meta").textContent = "";
    view().innerHTML = `<div style="padding:40px;text-align:center;color:var(--ink-soft);">Loading…</div>`;
    try{
      if(id==="dashboard") await Dashboard.render();
      else if(id==="employees") await Employees.render();
      else if(id==="timesheets") await Timesheets.render();
      else if(id==="leave") await Leave.render();
      else if(id==="payroll") await Payroll.render();
      else if(id==="payslips") await Payslips.render();
      else if(id==="reports") await Reports.render();
      else if(id==="settings") await Settings.render();
    }catch(e){
      console.error(e);
      view().innerHTML = `<div class="card"><strong style="color:var(--danger)">Something went wrong loading this view.</strong><p class="mono" style="font-size:12px;color:var(--ink-soft)">${esc(e.message)}</p></div>`;
    }
  }
};

// ------------------------------------------------------------
// DASHBOARD
// ------------------------------------------------------------
const Dashboard = {
  async render(){
    const period = currentPeriod();
    const employees = State.employees;
    const active = employees.filter(e=>e.active!==false);
    let payslipsThisMonth = [];
    try{
      const q = query(col("payslips"), where("period","==",period));
      payslipsThisMonth = (await getDocs(q)).docs.map(d=>d.data());
    }catch(e){/* index might not exist yet on first run */ payslipsThisMonth=[]; }
    const totalNet = payslipsThisMonth.reduce((s,p)=>s+(p.netPay||0),0);
    const totalGross = payslipsThisMonth.reduce((s,p)=>s+(p.earnings?.gross||0),0);

    view().innerHTML = `
      <div class="grid cols-4">
        <div class="stat"><div class="label">Active Employees</div><div class="value">${active.length}</div></div>
        <div class="stat"><div class="label">Payslips — ${esc(monthLabel(period))}</div><div class="value">${payslipsThisMonth.length}</div></div>
        <div class="stat"><div class="label">Gross Payroll (MTD)</div><div class="value" style="font-size:20px;">${R(totalGross)}</div></div>
        <div class="stat"><div class="label">Net Payroll (MTD)</div><div class="value" style="font-size:20px;">${R(totalNet)}</div></div>
      </div>
      <div class="grid cols-2">
        <div class="card">
          <h3>Quick Actions</h3>
          <div style="display:flex;flex-direction:column;gap:10px;margin-top:6px;">
            <button class="btn btn-primary" data-nav="employees">+ Add Employee</button>
            <button class="btn btn-dark" data-nav="timesheets">Capture Timesheets</button>
            <button class="btn btn-outline" data-nav="payroll">Run Payroll for ${esc(monthLabel(period))}</button>
          </div>
        </div>
        <div class="card">
          <h3>Employees Missing This Month's Timesheet</h3>
          <div id="missing-ts">Checking…</div>
        </div>
      </div>
    `;
    $$("[data-nav]", view()).forEach(b=>b.addEventListener("click", ()=>Router.go(b.dataset.nav)));

    // Missing timesheets check
    const missing = [];
    for(const emp of active){
      const snap = await getDoc(doc(db,"timesheets", `${emp.id}_${period}`));
      if(!snap.exists()) missing.push(emp);
    }
    $("#missing-ts").innerHTML = missing.length===0
      ? `<p class="pill pill-ok">All caught up ✓</p>`
      : missing.map(e=>`<span class="pill pill-warn" style="margin:2px 4px 2px 0;">${esc(e.name)}</span>`).join("");
  }
};

// ------------------------------------------------------------
// EMPLOYEES
// ------------------------------------------------------------
const Employees = {
  async render(){
    await loadEmployees();
    const rows = State.employees;
    view().innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <h3 style="margin:0;">Employee Register (${rows.length})</h3>
          <button class="btn btn-primary" id="add-emp">+ Add Employee</button>
        </div>
        <table>
          <thead><tr>
            <th>Emp No.</th><th>Name</th><th>Position</th><th>Pay Type</th><th class="num">Rate</th>
            <th>Status</th><th></th>
          </tr></thead>
          <tbody>
            ${rows.map(e=>`
              <tr>
                <td class="mono">${esc(e.empNo)}</td>
                <td>${esc(e.name)}</td>
                <td>${esc(e.position||'—')}</td>
                <td><span class="pill pill-steel">${esc(e.payType)}</span></td>
                <td class="num">${R(e.rate)}${e.payType==='hourly'?'/hr':e.payType==='daily'?'/day':'/mo'}</td>
                <td>${e.active===false ? '<span class="pill pill-danger">Inactive</span>' : '<span class="pill pill-ok">Active</span>'}</td>
                <td style="text-align:right;">
                  <button class="btn btn-outline btn-sm" data-edit="${e.id}">Edit</button>
                </td>
              </tr>
            `).join('') || `<tr><td colspan="7" style="text-align:center;color:var(--ink-soft);padding:24px;">No employees yet — add your first one.</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
    $("#add-emp").addEventListener("click", ()=>this.openForm());
    $$("[data-edit]", view()).forEach(b=>b.addEventListener("click", ()=>this.openForm(b.dataset.edit)));
  },
  async openForm(id){
    const emp = id ? empById(id) : null;
    const lb = emp?.leaveBalances || {annual:15, sick:10, familyResponsibility:3};
    openModal(`
      <h3>${emp ? 'Edit Employee' : 'Add Employee'}</h3>
      <div class="grid cols-2">
        <div class="field"><label>Full Name</label><input id="f-name" value="${esc(emp?.name)}"></div>
        <div class="field"><label>ID Number</label><input id="f-id" value="${esc(emp?.idNumber)}"></div>
        <div class="field"><label>Position</label><input id="f-position" value="${esc(emp?.position)}"></div>
        <div class="field"><label>Start Date</label><input type="date" id="f-start" value="${esc(emp?.startDate||todayISO())}"></div>
        <div class="field">
          <label>Pay Type</label>
          <select id="f-paytype">
            <option value="hourly" ${emp?.payType==='hourly'?'selected':''}>Hourly</option>
            <option value="daily" ${emp?.payType==='daily'?'selected':''}>Daily</option>
            <option value="monthly" ${emp?.payType==='monthly'?'selected':''}>Fixed Monthly</option>
          </select>
        </div>
        <div class="field"><label>Rate (R)</label><input type="number" step="0.01" id="f-rate" value="${emp?.rate||''}"></div>
        <div class="field">
          <label>Age Band (for tax rebate)</label>
          <select id="f-age">
            <option value="under65" ${(!emp||emp.ageBand==='under65')?'selected':''}>Under 65</option>
            <option value="age65to74" ${emp?.ageBand==='age65to74'?'selected':''}>65–74</option>
            <option value="age75plus" ${emp?.ageBand==='age75plus'?'selected':''}>75+</option>
          </select>
        </div>
        <div class="field">
          <label>Status</label>
          <select id="f-active">
            <option value="true" ${(!emp||emp.active!==false)?'selected':''}>Active</option>
            <option value="false" ${emp?.active===false?'selected':''}>Inactive</option>
          </select>
        </div>
      </div>
      <h3 style="margin-top:18px;">Banking Details</h3>
      <div class="grid cols-2">
        <div class="field"><label>Bank Name</label><input id="f-bank" value="${esc(emp?.bankName)}"></div>
        <div class="field"><label>Account Type</label><input id="f-accttype" value="${esc(emp?.accountType||'Cheque/Current')}"></div>
        <div class="field"><label>Account Number</label><input id="f-acctno" value="${esc(emp?.bankAccountNo)}"></div>
        <div class="field"><label>Branch Code</label><input id="f-branch" value="${esc(emp?.branchCode)}"></div>
      </div>
      <h3 style="margin-top:18px;">Leave Balances (days)</h3>
      <div class="grid cols-3">
        <div class="field"><label>Annual</label><input type="number" step="0.5" id="f-lv-annual" value="${lb.annual}"></div>
        <div class="field"><label>Sick</label><input type="number" step="0.5" id="f-lv-sick" value="${lb.sick}"></div>
        <div class="field"><label>Family Resp.</label><input type="number" step="0.5" id="f-lv-fr" value="${lb.familyResponsibility}"></div>
      </div>
      <div class="modal-actions">
        ${emp ? `<button class="btn btn-danger" id="del-emp">Delete</button>` : ``}
        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" id="save-emp">Save</button>
      </div>
    `);
    $("#save-emp").addEventListener("click", async ()=>{
      const data = {
        name: $("#f-name").value.trim(),
        idNumber: $("#f-id").value.trim(),
        position: $("#f-position").value.trim(),
        startDate: $("#f-start").value,
        payType: $("#f-paytype").value,
        rate: Number($("#f-rate").value)||0,
        ageBand: $("#f-age").value,
        active: $("#f-active").value === "true",
        bankName: $("#f-bank").value.trim(),
        accountType: $("#f-accttype").value.trim(),
        bankAccountNo: $("#f-acctno").value.trim(),
        branchCode: $("#f-branch").value.trim(),
        leaveBalances: {
          annual: Number($("#f-lv-annual").value)||0,
          sick: Number($("#f-lv-sick").value)||0,
          familyResponsibility: Number($("#f-lv-fr").value)||0,
        }
      };
      if(!data.name){ toast("Please enter a name.", true); return; }
      try{
        if(emp){
          await updateDoc(doc(db,"employees", emp.id), data);
          toast("Employee updated.");
        } else {
          const empNo = await nextSequence("employees", "DPC-EMP");
          await addDoc(col("employees"), {...data, empNo, createdAt: serverTimestamp()});
          toast("Employee added.");
        }
        closeModal();
        await Employees.render();
      }catch(e){ toast("Save failed: "+e.message, true); }
    });
    if(emp){
      $("#del-emp").addEventListener("click", async ()=>{
        if(!confirm(`Remove ${emp.name} from the register? This cannot be undone.`)) return;
        await deleteDoc(doc(db,"employees", emp.id));
        toast("Employee deleted.");
        closeModal();
        await Employees.render();
      });
    }
  }
};
window.Employees = Employees;

// ------------------------------------------------------------
// TIMESHEETS
// ------------------------------------------------------------
const Timesheets = {
  period: currentPeriod(),
  async render(){
    await loadEmployees();
    const active = State.employees.filter(e=>e.active!==false);
    const rows = [];
    for(const emp of active){
      const snap = await getDoc(doc(db,"timesheets", `${emp.id}_${this.period}`));
      rows.push({emp, ts: snap.exists() ? snap.data() : null});
    }
    view().innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px;">
          <h3 style="margin:0;">Timesheets — ${esc(monthLabel(this.period))}</h3>
          <input type="month" id="ts-period" value="${this.period}" style="width:auto;">
        </div>
        <table>
          <thead><tr>
            <th>Employee</th><th>Pay Type</th><th class="num">Normal Hrs / Days</th><th class="num">Overtime Hrs</th>
            <th class="num">Sunday/PH Hrs</th><th class="num">Allowances</th><th class="num">Bonuses</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>
            ${rows.map(({emp,ts})=>`
              <tr>
                <td>${esc(emp.name)} <span class="mono" style="color:var(--ink-soft);font-size:11px;">${esc(emp.empNo)}</span></td>
                <td><span class="pill pill-steel">${esc(emp.payType)}</span></td>
                <td class="num">${emp.payType==='daily' ? (ts?.daysWorked ?? '—') : (ts?.normalHours ?? '—')}</td>
                <td class="num">${ts?.overtimeHours ?? '—'}</td>
                <td class="num">${ts?.sundayHours ?? '—'}</td>
                <td class="num">${ts ? R(ts.allowances||0) : '—'}</td>
                <td class="num">${ts ? R(ts.bonuses||0) : '—'}</td>
                <td>${ts ? '<span class="pill pill-ok">Captured</span>' : '<span class="pill pill-warn">Missing</span>'}</td>
                <td style="text-align:right;"><button class="btn btn-outline btn-sm" data-ts="${emp.id}">${ts?'Edit':'Capture'}</button></td>
              </tr>
            `).join('') || `<tr><td colspan="9" style="text-align:center;color:var(--ink-soft);padding:24px;">No active employees. Add employees first.</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
    $("#ts-period").addEventListener("change", (e)=>{ this.period = e.target.value; this.render(); });
    $$("[data-ts]", view()).forEach(b=>b.addEventListener("click", ()=>this.openForm(b.dataset.ts)));
  },
  async openForm(empId){
    const emp = empById(empId);
    const ref = doc(db,"timesheets", `${empId}_${this.period}`);
    const snap = await getDoc(ref);
    const ts = snap.exists() ? snap.data() : {};
    const isHourly = emp.payType==='hourly', isDaily = emp.payType==='daily', isMonthly = emp.payType==='monthly';
    openModal(`
      <h3>Timesheet — ${esc(emp.name)}</h3>
      <p style="font-size:12px;color:var(--ink-soft);margin-top:-8px;">${esc(monthLabel(this.period))} · ${esc(emp.payType)} @ ${R(emp.rate)}${isHourly?'/hr':isDaily?'/day':'/mo'}</p>
      <div class="grid cols-2">
        ${isDaily ? `<div class="field"><label>Days Worked</label><input type="number" step="0.5" id="ts-days" value="${ts.daysWorked??''}"></div>` :
          `<div class="field"><label>${isMonthly?'Normal Hours (info only)':'Normal Hours'}</label><input type="number" step="0.5" id="ts-hours" value="${ts.normalHours??''}"></div>`}
        <div class="field"><label>Overtime Hours (×1.5)</label><input type="number" step="0.5" id="ts-ot" value="${ts.overtimeHours??''}"></div>
        <div class="field"><label>Sunday / Public Holiday Hours (×2)</label><input type="number" step="0.5" id="ts-sun" value="${ts.sundayHours??''}"></div>
        ${isMonthly ? `<div class="field"><label>Unpaid Leave Days</label><input type="number" step="0.5" id="ts-unpaid" value="${ts.unpaidLeaveDays??0}"></div>` : ``}
        <div class="field"><label>Allowances (R)</label><input type="number" step="0.01" id="ts-allow" value="${ts.allowances??0}"></div>
        <div class="field"><label>Bonuses (R)</label><input type="number" step="0.01" id="ts-bonus" value="${ts.bonuses??0}"></div>
        <div class="field"><label>Other Deductions (R)</label><input type="number" step="0.01" id="ts-otherded" value="${ts.otherDeductions??0}"></div>
      </div>
      <div class="field"><label>Notes</label><textarea id="ts-notes" rows="2">${esc(ts.notes)}</textarea></div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" id="save-ts">Save Timesheet</button>
      </div>
    `);
    $("#save-ts").addEventListener("click", async ()=>{
      const data = {
        employeeId: empId, period: this.period,
        normalHours: isDaily?0:Number($("#ts-hours")?.value)||0,
        daysWorked: isDaily?Number($("#ts-days").value)||0:0,
        overtimeHours: Number($("#ts-ot").value)||0,
        sundayHours: Number($("#ts-sun").value)||0,
        unpaidLeaveDays: isMonthly ? (Number($("#ts-unpaid").value)||0) : 0,
        allowances: Number($("#ts-allow").value)||0,
        bonuses: Number($("#ts-bonus").value)||0,
        otherDeductions: Number($("#ts-otherded").value)||0,
        notes: $("#ts-notes").value.trim(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(ref, data, {merge:true});
      toast("Timesheet saved.");
      closeModal();
      await Timesheets.render();
    });
  }
};
window.Timesheets = Timesheets;

// ------------------------------------------------------------
// LEAVE REGISTER
// ------------------------------------------------------------
const LEAVE_TYPES = {annual:"Annual", sick:"Sick", familyResponsibility:"Family Responsibility"};
const Leave = {
  async render(){
    await loadEmployees();
    const records = await getAllDocs("leave");
    records.sort((a,b)=> (b.startDate||'').localeCompare(a.startDate||''));
    view().innerHTML = `
      <div class="grid cols-2">
        ${State.employees.filter(e=>e.active!==false).map(e=>`
          <div class="card" style="margin-bottom:0;">
            <h3 style="border:none;">${esc(e.name)}</h3>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <span class="pill pill-steel">Annual: ${e.leaveBalances?.annual ?? 0}d</span>
              <span class="pill pill-steel">Sick: ${e.leaveBalances?.sick ?? 0}d</span>
              <span class="pill pill-steel">Family Resp: ${e.leaveBalances?.familyResponsibility ?? 0}d</span>
            </div>
          </div>
        `).join('') || `<div class="card">No active employees yet.</div>`}
      </div>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <h3 style="margin:0;">Leave Records</h3>
          <button class="btn btn-primary" id="add-leave">+ Capture Leave</button>
        </div>
        <table>
          <thead><tr><th>Employee</th><th>Type</th><th>From</th><th>To</th><th class="num">Days</th><th>Notes</th><th></th></tr></thead>
          <tbody>
            ${records.map(r=>{
              const emp = empById(r.employeeId);
              return `<tr>
                <td>${esc(emp?.name || 'Unknown')}</td>
                <td><span class="pill pill-steel">${esc(LEAVE_TYPES[r.type]||r.type)}</span></td>
                <td>${esc(r.startDate)}</td><td>${esc(r.endDate)}</td>
                <td class="num">${r.days}</td>
                <td style="font-size:12px;color:var(--ink-soft);">${esc(r.notes||'')}</td>
                <td style="text-align:right;"><button class="btn btn-danger btn-sm" data-del-leave="${r.id}">Delete</button></td>
              </tr>`;
            }).join('') || `<tr><td colspan="7" style="text-align:center;color:var(--ink-soft);padding:24px;">No leave captured yet.</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
    $("#add-leave").addEventListener("click", ()=>this.openForm());
    $$("[data-del-leave]", view()).forEach(b=>b.addEventListener("click", async ()=>{
      if(!confirm("Delete this leave record? Balances will not be automatically restored.")) return;
      await deleteDoc(doc(db,"leave", b.dataset.delLeave));
      toast("Leave record deleted.");
      await Leave.render();
    }));
  },
  openForm(){
    const active = State.employees.filter(e=>e.active!==false);
    openModal(`
      <h3>Capture Leave</h3>
      <div class="field"><label>Employee</label>
        <select id="lv-emp">${active.map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select>
      </div>
      <div class="grid cols-2">
        <div class="field"><label>Type</label>
          <select id="lv-type">
            <option value="annual">Annual</option>
            <option value="sick">Sick</option>
            <option value="familyResponsibility">Family Responsibility</option>
          </select>
        </div>
        <div class="field"><label>Days</label><input type="number" step="0.5" id="lv-days" value="1"></div>
        <div class="field"><label>From</label><input type="date" id="lv-from" value="${todayISO()}"></div>
        <div class="field"><label>To</label><input type="date" id="lv-to" value="${todayISO()}"></div>
      </div>
      <div class="field"><label>Notes</label><textarea id="lv-notes" rows="2"></textarea></div>
      <p style="font-size:12px;color:var(--ink-soft);">Saving will deduct the days from the employee's leave balance.</p>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" id="save-leave">Save</button>
      </div>
    `);
    $("#save-leave").addEventListener("click", async ()=>{
      const employeeId = $("#lv-emp").value;
      const type = $("#lv-type").value;
      const days = Number($("#lv-days").value)||0;
      const emp = empById(employeeId);
      if(days<=0){ toast("Enter a valid number of days.", true); return; }
      try{
        await addDoc(col("leave"), {
          employeeId, type, days,
          startDate: $("#lv-from").value, endDate: $("#lv-to").value,
          notes: $("#lv-notes").value.trim(), createdAt: serverTimestamp(),
        });
        const empRef = doc(db,"employees", employeeId);
        const curBalance = emp.leaveBalances?.[type] ?? 0;
        await updateDoc(empRef, { [`leaveBalances.${type}`]: Math.round((curBalance-days)*100)/100 });
        toast("Leave captured and balance updated.");
        closeModal();
        await Leave.render();
      }catch(e){ toast("Failed: "+e.message, true); }
    });
  }
};
window.Leave = Leave;

// ------------------------------------------------------------
// RUN PAYROLL
// ------------------------------------------------------------
const Payroll = {
  period: currentPeriod(),
  selected: new Set(),
  async render(){
    await loadEmployees();
    const active = State.employees.filter(e=>e.active!==false);
    if(this.selected.size===0) active.forEach(e=>this.selected.add(e.id));
    const preview = [];
    for(const emp of active){
      const tsSnap = await getDoc(doc(db,"timesheets", `${emp.id}_${this.period}`));
      const ts = tsSnap.exists() ? tsSnap.data() : {};
      const earn = computeEarnings(emp, ts);
      const paye = calcMonthlyPAYE(earn.gross, emp.ageBand);
      const uif = calcUIF(earn.gross);
      const otherDed = Number(ts.otherDeductions)||0;
      const totalDed = paye+uif+otherDed;
      const net = Math.max(0, earn.gross-totalDed);
      preview.push({emp, ts, earn, paye, uif, otherDed, totalDed, net, hasTs: tsSnap.exists()});
    }
    const totalGross = preview.filter(p=>this.selected.has(p.emp.id)).reduce((s,p)=>s+p.earn.gross,0);
    const totalNet = preview.filter(p=>this.selected.has(p.emp.id)).reduce((s,p)=>s+p.net,0);

    view().innerHTML = `
      <div class="card">
        <p style="font-size:12px;color:var(--ink-soft);margin-top:0;">
          PAYE and UIF are estimated using SARS's ${esc(TAX_YEAR_LABEL)} tables. This is a simplified small-business
          estimate — please reconcile against SARS's official deduction tables (or your accountant) before submitting to SARS.
        </p>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px;">
          <h3 style="margin:0;">Payroll Preview — ${esc(monthLabel(this.period))}</h3>
          <input type="month" id="pr-period" value="${this.period}" style="width:auto;">
        </div>
        <table>
          <thead><tr>
            <th><input type="checkbox" id="chk-all"></th><th>Employee</th><th class="num">Gross</th>
            <th class="num">PAYE</th><th class="num">UIF</th><th class="num">Other Ded.</th><th class="num">Net Pay</th><th>Timesheet</th>
          </tr></thead>
          <tbody>
            ${preview.map(p=>`
              <tr>
                <td><input type="checkbox" class="pr-chk" data-id="${p.emp.id}" ${this.selected.has(p.emp.id)?'checked':''}></td>
                <td>${esc(p.emp.name)} <span class="mono" style="color:var(--ink-soft);font-size:11px;">${esc(p.emp.empNo)}</span></td>
                <td class="num">${R(p.earn.gross)}</td>
                <td class="num">${R(p.paye)}</td>
                <td class="num">${R(p.uif)}</td>
                <td class="num">${R(p.otherDed)}</td>
                <td class="num" style="font-weight:700;">${R(p.net)}</td>
                <td>${p.hasTs ? '<span class="pill pill-ok">Captured</span>' : '<span class="pill pill-warn">Missing (using 0)</span>'}</td>
              </tr>
            `).join('') || `<tr><td colspan="8" style="text-align:center;color:var(--ink-soft);padding:24px;">No active employees.</td></tr>`}
          </tbody>
        </table>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;flex-wrap:wrap;gap:12px;">
          <div style="font-size:13px;">
            Selected totals — Gross: <strong>${R(totalGross)}</strong> &nbsp;|&nbsp; Net: <strong>${R(totalNet)}</strong>
          </div>
          <button class="btn btn-primary" id="run-payroll">Generate Payslips for Selected</button>
        </div>
      </div>
    `;
    $("#pr-period").addEventListener("change", (e)=>{ this.period=e.target.value; this.render(); });
    $("#chk-all").addEventListener("change", (e)=>{
      if(e.target.checked) active.forEach(a=>this.selected.add(a.id));
      else this.selected.clear();
      this.render();
    });
    $$(".pr-chk", view()).forEach(c=>c.addEventListener("change", (e)=>{
      if(e.target.checked) this.selected.add(e.target.dataset.id);
      else this.selected.delete(e.target.dataset.id);
    }));
    $("#run-payroll").addEventListener("click", ()=>this.runPayroll(preview.filter(p=>this.selected.has(p.emp.id))));
  },
  async runPayroll(items){
    if(items.length===0){ toast("Select at least one employee.", true); return; }
    if(!confirm(`Generate ${items.length} payslip(s) for ${monthLabel(this.period)}? This will overwrite any existing payslips for these employees this period.`)) return;
    let count=0;
    for(const p of items){
      const payslipNumber = await nextSequence(`payslips_${this.period}`, `DPC-${this.period}`, 4);
      const payload = {
        payslipNumber,
        employeeId: p.emp.id, employeeName: p.emp.name, empNo: p.emp.empNo, position: p.emp.position||'',
        period: this.period, payDate: todayISO(),
        payType: p.emp.payType, rate: p.emp.rate,
        earnings: { normalPay:p.earn.normalPay, otPay:p.earn.otPay, sundayPay:p.earn.sundayPay, allowances:p.earn.allowances, bonuses:p.earn.bonuses, unpaidDeduction:p.earn.unpaidDeduction, gross:p.earn.gross },
        deductions: { paye:p.paye, uif:p.uif, other:p.otherDed, total:p.totalDed },
        netPay: p.net,
        leaveBalancesSnapshot: p.emp.leaveBalances || {},
        bankSnapshot: { bankName:p.emp.bankName||'', accountType:p.emp.accountType||'', bankAccountNo:p.emp.bankAccountNo||'', branchCode:p.emp.branchCode||'' },
        companySnapshot: {...State.company},
        createdAt: serverTimestamp(),
      };
      await setDoc(doc(db,"payslips", `${p.emp.id}_${this.period}`), payload);
      count++;
    }
    toast(`${count} payslip(s) generated.`);
    Router.go("payslips");
  }
};
window.Payroll = Payroll;

// ------------------------------------------------------------
// PAYSLIPS (view / print / QR)
// ------------------------------------------------------------
const Payslips = {
  period: currentPeriod(),
  async render(){
    let rows = [];
    try{
      const q = query(col("payslips"), where("period","==",this.period));
      rows = (await getDocs(q)).docs.map(d=>({id:d.id, ...d.data()}));
    }catch(e){ rows = []; }
    rows.sort((a,b)=> (a.empNo||'').localeCompare(b.empNo||''));
    view().innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px;">
          <h3 style="margin:0;">Payslips — ${esc(monthLabel(this.period))}</h3>
          <input type="month" id="ps-period" value="${this.period}" style="width:auto;">
        </div>
        <table>
          <thead><tr><th>Payslip #</th><th>Employee</th><th class="num">Gross</th><th class="num">Deductions</th><th class="num">Net Pay</th><th></th></tr></thead>
          <tbody>
            ${rows.map(r=>`
              <tr>
                <td class="mono">${esc(r.payslipNumber)}</td>
                <td>${esc(r.employeeName)}</td>
                <td class="num">${R(r.earnings?.gross)}</td>
                <td class="num">${R(r.deductions?.total)}</td>
                <td class="num" style="font-weight:700;">${R(r.netPay)}</td>
                <td style="text-align:right;"><button class="btn btn-outline btn-sm" data-view-ps="${r.id}">View</button></td>
              </tr>
            `).join('') || `<tr><td colspan="6" style="text-align:center;color:var(--ink-soft);padding:24px;">No payslips generated for this period yet — go to Run Payroll.</td></tr>`}
          </tbody>
        </table>
      </div>
      <div id="ps-detail"></div>
    `;
    $("#ps-period").addEventListener("change",(e)=>{ this.period=e.target.value; this.render(); });
    $$("[data-view-ps]", view()).forEach(b=>b.addEventListener("click", ()=>this.showPayslip(b.dataset.viewPs)));
  },
  async showPayslip(id){
    const snap = await getDoc(doc(db,"payslips", id));
    if(!snap.exists()){ toast("Payslip not found.", true); return; }
    const p = snap.data();
    const co = p.companySnapshot || State.company;
    const qrId = "qr-"+id;
    view().innerHTML += `
      <div class="card no-print" style="display:flex;gap:10px;justify-content:flex-end;">
        <button class="btn btn-outline" onclick="Router.go('payslips')">← Back to list</button>
        <button class="btn btn-primary" onclick="window.print()">Print / Save PDF</button>
      </div>
      <div class="payslip" id="ps-print">
        <div class="payslip-head">
          <div>
            <div class="co-name">${esc(co.name||'DP Construction Group')}</div>
            <div class="co-sub">${esc(co.address||'')}${co.regNo ? ' · Reg No: '+esc(co.regNo) : ''}</div>
            <div class="co-sub">${esc(co.phone||'')} ${co.email? '· '+esc(co.email):''}</div>
          </div>
          ${co.logoDataUrl ? `<img class="logo" src="${co.logoDataUrl}">` : ``}
        </div>
        <div class="payslip-body">
          <div class="grid cols-2" style="margin-bottom:10px;">
            <div>
              <div style="font-size:13px;"><strong>${esc(p.employeeName)}</strong></div>
              <div style="font-size:12px;color:var(--ink-soft);">${esc(p.position||'')} · Emp No: ${esc(p.empNo)}</div>
            </div>
            <div style="text-align:right;">
              <div class="num" style="font-size:12px;">Payslip #: <span class="mono">${esc(p.payslipNumber)}</span></div>
              <div style="font-size:12px;color:var(--ink-soft);">Pay Period: ${esc(monthLabel(p.period))} · Pay Date: ${esc(p.payDate)}</div>
            </div>
          </div>

          <div class="payslip-section">
            <h4>Earnings</h4>
            <div class="payslip-row"><span>Normal Pay</span><span class="mono">${R(p.earnings.normalPay)}</span></div>
            <div class="payslip-row"><span>Overtime Pay</span><span class="mono">${R(p.earnings.otPay)}</span></div>
            <div class="payslip-row"><span>Sunday / PH Pay</span><span class="mono">${R(p.earnings.sundayPay)}</span></div>
            <div class="payslip-row"><span>Allowances</span><span class="mono">${R(p.earnings.allowances)}</span></div>
            <div class="payslip-row"><span>Bonuses</span><span class="mono">${R(p.earnings.bonuses)}</span></div>
            ${p.earnings.unpaidDeduction ? `<div class="payslip-row"><span>Unpaid Leave Deduction</span><span class="mono">−${R(p.earnings.unpaidDeduction)}</span></div>` : ``}
            <div class="payslip-row total"><span>Gross Pay</span><span class="mono">${R(p.earnings.gross)}</span></div>
          </div>

          <div class="payslip-section">
            <h4>Deductions</h4>
            <div class="payslip-row"><span>PAYE</span><span class="mono">${R(p.deductions.paye)}</span></div>
            <div class="payslip-row"><span>UIF</span><span class="mono">${R(p.deductions.uif)}</span></div>
            <div class="payslip-row"><span>Other Deductions</span><span class="mono">${R(p.deductions.other)}</span></div>
            <div class="payslip-row total"><span>Total Deductions</span><span class="mono">${R(p.deductions.total)}</span></div>
          </div>

          <div class="payslip-section">
            <h4>Leave Balances</h4>
            <div class="payslip-row"><span>Annual</span><span class="mono">${p.leaveBalancesSnapshot?.annual ?? 0} days</span></div>
            <div class="payslip-row"><span>Sick</span><span class="mono">${p.leaveBalancesSnapshot?.sick ?? 0} days</span></div>
            <div class="payslip-row"><span>Family Responsibility</span><span class="mono">${p.leaveBalancesSnapshot?.familyResponsibility ?? 0} days</span></div>
          </div>

          <div class="payslip-net">
            <span class="label">Net Pay</span>
            <span class="amt">${R(p.netPay)}</span>
          </div>
        </div>
        <div class="payslip-stub">
          <div style="font-size:11px;color:var(--ink-soft);line-height:1.6;">
            <strong>Bank:</strong> ${esc(p.bankSnapshot?.bankName||'—')}<br>
            <strong>Acc No:</strong> ${esc(p.bankSnapshot?.bankAccountNo||'—')} (${esc(p.bankSnapshot?.accountType||'—')})<br>
            <strong>Branch Code:</strong> ${esc(p.bankSnapshot?.branchCode||'—')}
          </div>
          <div class="qr" id="${qrId}"></div>
        </div>
      </div>
    `;
    // Render QR code
    setTimeout(()=>{
      const el = document.getElementById(qrId);
      if(el && window.QRCode){
        const payload = `DPC PAYSLIP\n${p.payslipNumber}\n${p.employeeName}\n${monthLabel(p.period)}\nNet: R${(p.netPay||0).toFixed(2)}`;
        QRCode.toCanvas(document.createElement("canvas"), payload, {width:88, margin:0}, (err, canvas)=>{
          if(!err){ el.innerHTML=""; el.appendChild(canvas); }
        });
      }
    }, 30);
  }
};
window.Payslips = Payslips;
window.Router = Router;

// ------------------------------------------------------------
// PAYROLL SUMMARY / REPORTS
// ------------------------------------------------------------
const Reports = {
  period: currentPeriod(),
  async render(){
    let rows = [];
    try{
      const q = query(col("payslips"), where("period","==",this.period));
      rows = (await getDocs(q)).docs.map(d=>d.data());
    }catch(e){ rows = []; }
    rows.sort((a,b)=> (a.empNo||'').localeCompare(b.empNo||''));
    const totals = rows.reduce((acc,r)=>{
      acc.gross += r.earnings?.gross||0;
      acc.paye += r.deductions?.paye||0;
      acc.uif += r.deductions?.uif||0;
      acc.other += r.deductions?.other||0;
      acc.net += r.netPay||0;
      return acc;
    }, {gross:0,paye:0,uif:0,other:0,net:0});

    view().innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px;">
          <h3 style="margin:0;">Payroll Summary — ${esc(monthLabel(this.period))}</h3>
          <div style="display:flex;gap:10px;">
            <input type="month" id="rp-period" value="${this.period}" style="width:auto;">
            <button class="btn btn-outline" id="rp-csv">Export CSV</button>
            <button class="btn btn-dark" onclick="window.print()">Print</button>
          </div>
        </div>
        <table>
          <thead><tr>
            <th>Emp No.</th><th>Employee</th><th class="num">Gross</th><th class="num">PAYE</th>
            <th class="num">UIF</th><th class="num">Other Ded.</th><th class="num">Net Pay</th>
          </tr></thead>
          <tbody>
            ${rows.map(r=>`
              <tr>
                <td class="mono">${esc(r.empNo)}</td><td>${esc(r.employeeName)}</td>
                <td class="num">${R(r.earnings?.gross)}</td><td class="num">${R(r.deductions?.paye)}</td>
                <td class="num">${R(r.deductions?.uif)}</td><td class="num">${R(r.deductions?.other)}</td>
                <td class="num" style="font-weight:700;">${R(r.netPay)}</td>
              </tr>
            `).join('') || `<tr><td colspan="7" style="text-align:center;color:var(--ink-soft);padding:24px;">No payslips for this period yet.</td></tr>`}
          </tbody>
          <tfoot>
            <tr style="font-weight:700;background:#FAF8F3;">
              <td colspan="2">Totals</td>
              <td class="num">${R(totals.gross)}</td><td class="num">${R(totals.paye)}</td>
              <td class="num">${R(totals.uif)}</td><td class="num">${R(totals.other)}</td><td class="num">${R(totals.net)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
    $("#rp-period").addEventListener("change",(e)=>{ this.period=e.target.value; this.render(); });
    $("#rp-csv").addEventListener("click", ()=>{
      const header = ["Emp No","Employee","Gross","PAYE","UIF","Other Deductions","Net Pay"];
      const lines = rows.map(r=>[r.empNo, r.employeeName, r.earnings?.gross||0, r.deductions?.paye||0, r.deductions?.uif||0, r.deductions?.other||0, r.netPay||0].join(","));
      const csv = [header.join(","), ...lines].join("\n");
      const blob = new Blob([csv], {type:"text/csv"});
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `payroll-summary-${this.period}.csv`;
      a.click();
    });
  }
};
window.Reports = Reports;

// ------------------------------------------------------------
// SETTINGS
// ------------------------------------------------------------
const Settings = {
  async render(){
    const c = State.company;
    view().innerHTML = `
      <div class="card" style="max-width:640px;">
        <h3>Company Details</h3>
        <p style="font-size:12px;color:var(--ink-soft);margin-top:-6px;">These appear on every payslip.</p>
        <div class="field"><label>Company Name</label><input id="s-name" value="${esc(c.name)}"></div>
        <div class="field"><label>Registration Number</label><input id="s-reg" value="${esc(c.regNo)}"></div>
        <div class="field"><label>Address</label><input id="s-addr" value="${esc(c.address)}"></div>
        <div class="grid cols-2">
          <div class="field"><label>Phone</label><input id="s-phone" value="${esc(c.phone)}"></div>
          <div class="field"><label>Email</label><input id="s-email" value="${esc(c.email)}"></div>
        </div>
        <div class="field">
          <label>Logo</label>
          <input type="file" id="s-logo" accept="image/*">
          ${c.logoDataUrl ? `<img src="${c.logoDataUrl}" style="max-height:60px;margin-top:8px;border:1px solid var(--line);border-radius:6px;padding:4px;">` : ``}
        </div>
        <button class="btn btn-primary" id="save-settings" style="margin-top:8px;">Save Company Details</button>
      </div>
      <div class="card" style="max-width:640px;">
        <h3>About This System</h3>
        <p style="font-size:13px;color:var(--ink-soft);line-height:1.6;">
          Built for DP Construction Group. Data is stored in your own Firebase project (Firestore), and this page is
          static — you can host it for free on GitHub Pages. PAYE/UIF figures use the ${esc(TAX_YEAR_LABEL)} SARS tables
          as a simplified small-business estimate; always confirm exact figures with SARS or your accountant before
          filing returns.
        </p>
      </div>
    `;
    let pendingLogo = null;
    $("#s-logo").addEventListener("change", (e)=>{
      const file = e.target.files[0];
      if(!file) return;
      const reader = new FileReader();
      reader.onload = ()=>{ pendingLogo = reader.result; };
      reader.readAsDataURL(file);
    });
    $("#save-settings").addEventListener("click", async ()=>{
      const data = {
        name: $("#s-name").value.trim(),
        regNo: $("#s-reg").value.trim(),
        address: $("#s-addr").value.trim(),
        phone: $("#s-phone").value.trim(),
        email: $("#s-email").value.trim(),
      };
      if(pendingLogo) data.logoDataUrl = pendingLogo;
      await setDoc(doc(db,"settings","company"), data, {merge:true});
      toast("Company details saved.");
      await loadCompany();
      await Settings.render();
    });
  }
};
window.Settings = Settings;
