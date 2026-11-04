'use strict';
(function () {
  /* ---------- Constantes ---------- */
  const KEY = 'mf.v1';
  const CATS = [
    { id: 'super', name: 'Super / kiosco', ico: '🛒' },
    { id: 'comida', name: 'Comida fuera', ico: '🍔' },
    { id: 'uber', name: 'Uber / transporte', ico: '🚕' },
    { id: 'online', name: 'Compras online', ico: '📦' },
    { id: 'bencina', name: 'Bencina', ico: '⛽' },
    { id: 'gustos', name: 'Gustos', ico: '🎧' },
    { id: 'salud', name: 'Salud', ico: '💊' },
    { id: 'otros', name: 'Otros', ico: '✨' },
  ];
  const METHODS = [
    { id: 'cc', name: 'Cta. corriente' },
    { id: 'cmr', name: 'CMR' },
    { id: 'cash', name: 'Débito / efectivo' },
  ];
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const TITLES = { inicio: 'Inicio', gastos: 'Gastos', metas: 'Metas', cmr: 'Tarjeta CMR', plan: 'Plan' };

  /* ---------- Utilidades ---------- */
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => parseInt(String(v == null ? '' : v).replace(/\D/g, ''), 10) || 0;
  const fmt = (n) => String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const clp = (n) => (Math.round(n) < 0 ? '-$' : '$') + fmt(n);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const pad = (n) => String(n).padStart(2, '0');
  const sod = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const dlabel = (d) => d.getDate() + ' ' + MONTHS[d.getMonth()];
  const mlabel = (ym) => { const [y, m] = ym.split('-').map(Number); return MONTHS[m - 1] + ' ' + y; };
  const catOf = (id) => CATS.find((c) => c.id === id) || CATS[CATS.length - 1];
  const methodOf = (id) => METHODS.find((m) => m.id === id) || METHODS[0];

  /* ---------- Estado ---------- */
  const defaults = () => ({
    v: 1,
    settings: { payday: 21, income: 0, savingsPct: 35, hormigaMax: 10000, cmrClose: 9, cmrDue: 25, planStart: '', setupDone: false },
    fixed: [],
    expenses: [],
    goals: [],
    cmr: { fees: 0, items: [] },
    done: {},
    last: { cat: 'super', method: 'cc' },
  });

  function normalize(raw) {
    const d = defaults();
    if (!raw || raw.v !== 1) return d;
    return {
      ...d,
      ...raw,
      settings: { ...d.settings, ...(raw.settings || {}) },
      cmr: { ...d.cmr, ...(raw.cmr || {}) },
      last: { ...d.last, ...(raw.last || {}) },
      fixed: raw.fixed || [],
      expenses: raw.expenses || [],
      goals: raw.goals || [],
      done: raw.done || {},
    };
  }

  let S;
  try { S = normalize(JSON.parse(localStorage.getItem(KEY))); } catch (e) { S = defaults(); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('No pude guardar en este navegador'); } };

  const G = { mode: 'lista', off: 0 }; // estado de la vista Gastos

  /* ---------- Periodos y presupuesto ---------- */
  function periodAt(offset = 0, ref = new Date()) {
    const pd = S.settings.payday;
    let s = new Date(ref.getFullYear(), ref.getMonth(), pd);
    if (sod(ref) < s) s = new Date(ref.getFullYear(), ref.getMonth() - 1, pd);
    s = new Date(s.getFullYear(), s.getMonth() + offset, pd);
    const e = new Date(s.getFullYear(), s.getMonth() + 1, pd);
    return { start: s, end: e, days: Math.round((e - s) / 864e5), key: ymd(s) };
  }

  // Período sobre el que se calcula el presupuesto (si el plan aún no parte, muestra el primero).
  function budgetPeriod() {
    const ps = S.settings.planStart ? parseYmd(S.settings.planStart) : null;
    if (ps && sod(new Date()) < ps) {
      return { p: periodAt(0, ps), preview: true, daysToStart: Math.ceil((ps - sod(new Date())) / 864e5) };
    }
    return { p: periodAt(0), preview: false, daysToStart: 0 };
  }

  const cmrDueDate = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, S.settings.cmrDue); };
  const cmrDueIn = (p) =>
    S.cmr.items.filter((it) => { const d = cmrDueDate(it.month); return d >= p.start && d < p.end; }).reduce((a, i) => a + i.amount, 0) + (S.cmr.fees || 0);

  function budget(p) {
    const income = S.settings.income;
    const fixed = S.fixed.reduce((a, f) => a + f.amount, 0);
    const cmr = cmrDueIn(p);
    const saving = Math.round((income * S.settings.savingsPct) / 100);
    const living = income - fixed - cmr - saving;
    return { income, fixed, cmr, saving, living, weekly: living / (p.days / 7) };
  }

  const expIn = (a, b, f) => S.expenses.filter((e) => e.ts >= +a && e.ts < +b && (!f || f(e)));
  const total = (arr) => arr.reduce((s, e) => s + e.amount, 0);
  const weekStart = (d = new Date()) => addDays(sod(d), -((sod(d).getDay() + 6) % 7));

  /* ---------- Vistas ---------- */
  function vInicio() {
    const { p, preview, daysToStart } = budgetPeriod();
    const b = budget(p);
    const now = new Date();
    const hasPlan = S.settings.income > 0;
    const cur = periodAt(0);
    let h = '';

    if (!hasPlan) {
      h += `<div class="card"><h2>Empecemos</h2><p>Configura tu sueldo, tus gastos fijos y tu ahorro para calcular cuánta plata tienes por semana.</p>
        <div class="row"><a class="btn primary" style="display:grid;place-items:center;text-decoration:none" href="#/plan">Ir a Plan</a></div></div>`;
    } else {
      const ws = weekStart(), spentW = total(expIn(ws, addDays(ws, 7)));
      const left = b.weekly - spentW;
      const pct = b.weekly > 0 ? Math.min(100, Math.max(0, (spentW / b.weekly) * 100)) : 100;
      const cls = left < 0 ? 'bad' : left < b.weekly * 0.2 ? 'warn' : 'ok';
      h += `<section class="hero ${cls}" aria-label="Dinero que te queda esta semana">
          <p class="eyebrow">${preview ? 'Vista previa de tu plan · ' : ''}Te quedan esta semana</p>
          <p class="big">${clp(left)}</p>
          <div class="bar"><i style="width:${pct}%"></i></div>
          <p class="sub">Gastaste ${clp(spentW)} de ${clp(b.weekly)} (lunes a domingo)</p>
        </section>`;

      if (preview) {
        h += `<div class="card"><h2>Tu plan parte el ${dlabel(p.start)}</h2>
          <p>Faltan <b>${daysToStart}</b> ${daysToStart === 1 ? 'día' : 'días'}. Mientras tanto anota cada gasto para conocer tu ritmo real.</p></div>`;
      } else {
        const spentP = total(expIn(p.start, p.end));
        const leftP = b.living - spentP;
        const daysLeft = Math.max(1, Math.ceil((p.end - sod(now)) / 864e5));
        h += `<div class="card"><h2>Hasta el ${dlabel(addDays(p.end, -1))}</h2>
          <div class="kv"><span>Te quedan para vivir</span><b class="num" style="color:var(--${leftP < 0 ? 'bad' : 'text'})">${clp(leftP)}</b></div>
          <div class="kv"><span>Promedio por día</span><b class="num">${clp(Math.max(0, leftP) / daysLeft)}</b></div></div>`;
      }

      // Ahorro del período
      const done = S.done[p.key] || [];
      const gl = S.goals.filter((g) => g.monthly > 0);
      if (gl.length) {
        const sum = gl.reduce((a, g) => a + g.monthly, 0);
        h += `<div class="card"><h2>Tu ahorro de este período</h2>
          <p class="small muted">Plan: ${clp(b.saving)} (${S.settings.savingsPct}% del sueldo). Tus metas suman ${clp(sum)}.</p>` +
          gl.map((g) => {
            const ok = done.includes(g.id);
            return `<div class="check"><div class="grow"><b>${esc(g.name)}</b><div class="small muted">${esc(g.account || '')}</div></div>
              <b class="num">${clp(g.monthly)}</b>
              ${ok ? '<span class="tag ok">✓ listo</span>' : `<button class="btn small" data-act="saved-ok" data-id="${g.id}" data-pk="${p.key}">Transferido</button>`}</div>`;
          }).join('') + '</div>';
      }
    }

    // Gasto hormiga
    const thr = S.settings.hormigaMax;
    const all = expIn(cur.start, cur.end);
    const small = all.filter((e) => e.amount <= thr);
    h += `<div class="card"><h2>Gasto hormiga · período actual</h2>` +
      (all.length
        ? `<p><b>${small.length}</b> ${small.length === 1 ? 'compra' : 'compras'} de ${clp(thr)} o menos suman <b>${clp(total(small))}</b>${total(all) ? ` (${Math.round((total(small) / total(all)) * 100)}% de lo que gastaste)` : ''}.</p>`
        : '<p class="muted">Aún no hay gastos anotados en este período.</p>') + '</div>';

    // CMR
    const nextDue = S.cmr.items.map((i) => ({ ...i, d: cmrDueDate(i.month) })).filter((i) => i.d >= sod(now)).sort((a, b2) => a.d - b2.d)[0];
    if (nextDue) {
      h += `<div class="card"><h2>Próximo pago CMR</h2><div class="kv"><span>Vence el ${dlabel(nextDue.d)}</span><b class="num">${clp(nextDue.amount + (S.cmr.fees || 0))}</b></div>
        <p class="small muted">Cuotas ya hechas${S.cmr.fees ? ' + seguros y comisión' : ''}. Sin compras nuevas en cuotas.</p></div>`;
    }
    return h;
  }

  function vGastos() {
    const p = periodAt(G.off);
    const list = expIn(p.start, p.end).sort((a, b) => b.ts - a.ts);
    let h = `<div class="seg" role="group" aria-label="Vista">
        <button data-act="gmode" data-id="lista" aria-pressed="${G.mode === 'lista'}">Lista</button>
        <button data-act="gmode" data-id="resumen" aria-pressed="${G.mode === 'resumen'}">Resumen</button></div>
      <div class="pernav"><button data-act="gper" data-id="-1" aria-label="Período anterior">‹</button>
        <b>${dlabel(p.start)} – ${dlabel(addDays(p.end, -1))}${G.off === 0 ? ' · actual' : ''}</b>
        <button data-act="gper" data-id="1" aria-label="Período siguiente" ${G.off >= 0 ? 'disabled' : ''}>›</button></div>`;

    if (!list.length) return h + '<p class="empty">No hay gastos en este período.<br>Usa el botón <b>+ Gasto</b> para anotar el primero.</p>';

    if (G.mode === 'lista') {
      let lastDay = '';
      for (const e of list) {
        const d = sod(new Date(e.ts));
        const dk = ymd(d);
        if (dk !== lastDay) {
          lastDay = dk;
          const t = sod(new Date());
          const lab = dk === ymd(t) ? 'Hoy' : dk === ymd(addDays(t, -1)) ? 'Ayer' : d.toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short' });
          h += `<div class="day">${esc(lab)}</div>`;
        }
        const c = catOf(e.cat);
        h += `<button class="item" data-act="edit-exp" data-id="${e.id}">
          <span class="ico" aria-hidden="true">${c.ico}</span>
          <span class="grow"><span class="t" style="display:block">${esc(e.note || c.name)}</span>
            <span class="s">${esc(c.name)} · <span class="badge ${e.method === 'cmr' ? 'cmr' : ''}">${esc(methodOf(e.method).name)}</span></span></span>
          <span class="amt">${clp(e.amount)}</span></button>`;
      }
      return h;
    }

    // Resumen
    const tot = total(list);
    const byCat = {};
    list.forEach((e) => { byCat[e.cat] = (byCat[e.cat] || 0) + e.amount; });
    const rows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    const max = rows[0][1];
    h += `<div class="card"><h2>Total del período</h2><p class="big" style="font-size:32px;font-weight:800;margin:0">${clp(tot)}</p>
      <p class="small muted">${list.length} gastos</p></div><div class="card"><h2>Por categoría</h2>` +
      rows.map(([id, v]) => `<div class="catrow"><div class="top2"><span>${catOf(id).ico} ${esc(catOf(id).name)}</span><span class="num">${clp(v)} · ${Math.round((v / tot) * 100)}%</span></div>
        <div class="bar"><i style="width:${(v / max) * 100}%"></i></div></div>`).join('') + '</div>';

    const thr = S.settings.hormigaMax;
    const small = list.filter((e) => e.amount <= thr);
    h += `<div class="card"><h2>Hormiga (${clp(thr)} o menos)</h2><div class="kv"><span>Compras</span><b>${small.length}</b></div>
      <div class="kv"><span>Suman</span><b class="num">${clp(total(small))}</b></div>
      <div class="kv"><span>Promedio por compra</span><b class="num">${small.length ? clp(total(small) / small.length) : '$0'}</b></div></div>`;

    h += '<div class="card"><h2>Según cómo pagaste</h2>' + METHODS.map((m) => {
      const v = total(list.filter((e) => e.method === m.id));
      return `<div class="kv"><span>${esc(m.name)}</span><b class="num">${clp(v)}</b></div>`;
    }).join('') + '</div>';

    h += '<div class="card"><h2>Los 5 más grandes</h2>' + [...list].sort((a, b) => b.amount - a.amount).slice(0, 5).map((e) =>
      `<div class="kv"><span>${esc(e.note || catOf(e.cat).name)}</span><b class="num">${clp(e.amount)}</b></div>`).join('') + '</div>';
    return h;
  }

  function monthsFromNow(ym) {
    const [y, m] = ym.split('-').map(Number);
    const n = new Date();
    return (y - n.getFullYear()) * 12 + (m - 1 - n.getMonth());
  }

  function vMetas() {
    const saved = S.goals.reduce((a, g) => a + g.saved, 0);
    const monthly = S.goals.reduce((a, g) => a + (g.monthly || 0), 0);
    let h = `<div class="card"><h2>Tus ahorros</h2><div class="kv"><span>Total en metas</span><b class="num">${clp(saved)}</b></div>
      <div class="kv"><span>Ahorro mensual planificado</span><b class="num">${clp(monthly)}</b></div></div>`;
    if (!S.goals.length) h += '<p class="empty">Aún no tienes metas.<br>Agrega la primera: vacaciones, cámara, emergencia…</p>';

    h += S.goals.map((g) => {
      const hasTarget = g.target > 0;
      const rest = Math.max(0, g.target - g.saved);
      const pct = hasTarget ? Math.min(100, (g.saved / g.target) * 100) : 0;
      let info = '';
      if (!hasTarget) info = '<span class="tag warn">Sin monto definido</span>';
      else if (rest === 0) info = '<span class="tag ok">¡Meta lograda!</span>';
      else {
        if (g.deadline) {
          // aportes que quedan hasta el mes límite: uno por cada día de pago (incluye el de este mes si aún no pasa)
          const mths = Math.max(1, monthsFromNow(g.deadline) + (new Date().getDate() <= S.settings.payday ? 1 : 0));
          const need = Math.ceil(rest / mths);
          const okk = (g.monthly || 0) >= need;
          info = `<span class="tag ${okk ? 'ok' : 'warn'}">${okk ? 'Vas a tiempo' : 'Te falta ritmo'} · necesitas ${clp(need)}/mes para ${mlabel(g.deadline)}</span>`;
        } else if (g.monthly > 0) {
          const mths = Math.ceil(rest / g.monthly);
          const d = new Date(); d.setMonth(d.getMonth() + mths);
          info = `<span class="tag ok">Al ritmo actual: ${mlabel(d.getFullYear() + '-' + pad(d.getMonth() + 1))}</span>`;
        }
      }
      return `<div class="card goal"><div class="head"><b>${esc(g.name)}</b><span class="num">${clp(g.saved)}${hasTarget ? ` / ${clp(g.target)}` : ''}</span></div>
        ${hasTarget ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}
        <div class="small muted">${g.account ? esc(g.account) + ' · ' : ''}${g.monthly ? clp(g.monthly) + ' al mes' : 'sin aporte mensual'}</div>${info}
        <div class="row"><button class="btn small" data-act="goal-add" data-id="${g.id}">+ Abonar</button><button class="btn small" data-act="goal-edit" data-id="${g.id}">Editar</button></div></div>`;
    }).join('');
    return h + '<div class="row"><button class="btn primary" data-act="goal-new">Nueva meta</button></div>';
  }

  function vCmr() {
    const items = [...S.cmr.items].sort((a, b) => a.month.localeCompare(b.month));
    const now = new Date(), cd = S.settings.cmrClose;
    let close = new Date(now.getFullYear(), now.getMonth(), cd);
    if (sod(now) > close) close = new Date(now.getFullYear(), now.getMonth() + 1, cd);
    const prev = new Date(close.getFullYear(), close.getMonth() - 1, cd);
    const purchases = total(expIn(addDays(prev, 1), addDays(close, 1), (e) => e.method === 'cmr'));
    const dueMonth = close.getFullYear() + '-' + pad(close.getMonth() + 1);
    const cuotas = items.filter((i) => i.month === dueMonth).reduce((a, i) => a + i.amount, 0);
    const fees = S.cmr.fees || 0;
    const est = cuotas + fees + purchases;
    const pend = items.reduce((a, i) => a + i.amount, 0);

    let h = `<div class="card"><h2>Próximo estado de cuenta</h2>
      <p class="small muted">Cierra el ${dlabel(close)} · vence el ${dlabel(cmrDueDate(dueMonth))}</p>
      <div class="kv"><span>Cuotas ya hechas</span><b class="num">${clp(cuotas)}</b></div>
      <div class="kv"><span>Seguros y comisión</span><b class="num">${clp(fees)}</b></div>
      <div class="kv"><span>Compras con CMR anotadas</span><b class="num">${clp(purchases)}</b></div>
      <div class="kv total"><span>Estimado a pagar</span><b class="num">${clp(est)}</b></div>
      <p class="small muted">Lo que compres desde el ${dlabel(addDays(close, 1))} entra al estado siguiente.</p></div>`;

    h += `<div class="card"><h2>Cuotas pendientes</h2>` +
      (items.length ? items.map((i) => `<div class="check"><div class="grow"><b>${esc(i.name)}</b><div class="small muted">vence ${dlabel(cmrDueDate(i.month))} ${cmrDueDate(i.month).getFullYear()}</div></div>
        <b class="num">${clp(i.amount)}</b><button class="btn small" data-act="cmr-edit" data-id="${i.id}">Editar</button></div>`).join('') +
        `<div class="kv total"><span>Total pendiente</span><b class="num">${clp(pend)}</b></div>` : '<p class="muted">No tienes cuotas pendientes. 🎉</p>') +
      '<div class="row"><button class="btn small" data-act="cmr-new">+ Agregar cuota</button></div></div>';

    h += `<div class="card"><h2>Regla</h2><p>Usa la CMR solo para lo que ya ibas a gastar y págala <b>completa</b> cada mes. Las cuotas con interés te cuestan ~5% extra; solo vale la pena si dicen 0%.</p></div>`;
    return h;
  }

  function vPlan() {
    const s = S.settings;
    const { p } = budgetPeriod();
    const b = budget(p);
    const inp = (label, path, val, extra = '') =>
      `<label class="field"><span>${label}</span><input data-set="${path}" ${extra} value="${esc(val)}"></label>`;
    let h = `<div class="card"><h2>Tu sueldo</h2>
      ${inp('Sueldo líquido mensual ($)', 'settings.income', s.income ? fmt(s.income) : '', 'inputmode="numeric"')}
      ${inp('Día de pago (1 a 28)', 'settings.payday', s.payday, 'inputmode="numeric"')}
      ${inp('Porcentaje a ahorro (%)', 'settings.savingsPct', s.savingsPct, 'inputmode="numeric"')}
      <label class="field"><span>El plan parte el (opcional)</span><input type="date" data-set="settings.planStart" value="${esc(s.planStart)}"></label></div>`;

    h += `<div class="card"><h2>Gastos fijos al mes</h2>` +
      (S.fixed.length ? S.fixed.map((f) => `<div class="check"><div class="grow"><b>${esc(f.name)}</b></div><b class="num">${clp(f.amount)}</b>
        <button class="btn small" data-act="fixed-edit" data-id="${f.id}">Editar</button></div>`).join('') : '<p class="muted">Agrega diezmo, mesada, celular, cuentas…</p>') +
      '<div class="row"><button class="btn small" data-act="fixed-new">+ Agregar gasto fijo</button></div></div>';

    h += `<div class="card"><h2>Tarjeta CMR</h2>
      ${inp('Seguros y comisión mensual ($)', 'cmr.fees', S.cmr.fees ? fmt(S.cmr.fees) : '', 'inputmode="numeric"')}
      ${inp('Día de cierre del estado', 'settings.cmrClose', s.cmrClose, 'inputmode="numeric"')}
      ${inp('Día de vencimiento', 'settings.cmrDue', s.cmrDue, 'inputmode="numeric"')}</div>`;

    h += `<div class="card"><h2>Gasto hormiga</h2>
      ${inp('Se considera hormiga hasta ($)', 'settings.hormigaMax', fmt(s.hormigaMax), 'inputmode="numeric"')}</div>`;

    h += `<div class="card"><h2>Resultado · período del ${dlabel(p.start)}</h2>
      <div class="kv"><span>Sueldo</span><b class="num">${clp(b.income)}</b></div>
      <div class="kv"><span>Gastos fijos</span><b class="num">-${fmt(b.fixed)}</b></div>
      <div class="kv"><span>CMR (cuotas + seguros)</span><b class="num">-${fmt(b.cmr)}</b></div>
      <div class="kv"><span>Ahorro (${s.savingsPct}%)</span><b class="num">-${fmt(b.saving)}</b></div>
      <div class="kv total"><span>Para vivir</span><b class="num">${clp(b.living)}</b></div>
      <div class="kv total"><span>Por semana</span><b class="num">${clp(b.weekly)}</b></div></div>`;

    h += `<div class="card"><h2>Tus datos</h2><p class="small muted">Todo se guarda solo en este dispositivo. Haz un respaldo de vez en cuando.</p>
      <div class="row"><button class="btn small" data-act="export">Exportar</button><button class="btn small" data-act="import">Importar</button></div>
      <div class="row"><button class="btn small danger" data-act="reset">Borrar todo</button></div></div>`;
    return h;
  }

  /* ---------- Render / navegación ---------- */
  const views = { inicio: vInicio, gastos: vGastos, metas: vMetas, cmr: vCmr, plan: vPlan };
  const route = () => { const r = (location.hash.match(/^#\/(\w+)/) || [])[1]; return views[r] ? r : 'inicio'; };

  function render(keepScroll) {
    const r = route();
    const y = window.scrollY;
    $('#title').textContent = TITLES[r];
    $('#view').innerHTML = views[r]();
    document.querySelectorAll('.tabs a').forEach((a) => {
      if (a.dataset.tab === r) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    $('#fab').hidden = r === 'plan';
    if (keepScroll) window.scrollTo(0, y);
  }

  window.addEventListener('hashchange', () => {
    if (location.hash === '#add') { history.replaceState(null, '', '#/inicio'); render(); openExpense(); return; }
    closeSheet(); window.scrollTo(0, 0); render();
  });

  /* ---------- Hoja inferior (sheet) y avisos ---------- */
  function openSheet(html) {
    $('#sheet-body').innerHTML = html;
    $('#sheet').hidden = false;
    document.body.classList.add('sheet-open');
  }
  function closeSheet() { $('#sheet').hidden = true; document.body.classList.remove('sheet-open'); }

  let toastTimer;
  function toast(msg, undo) {
    const t = $('#toast');
    t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button data-act="undo">Deshacer</button>' : ''}`;
    t.hidden = false;
    t._undo = undo || null;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
  }

  const moneyInput = (el) => el.addEventListener('input', () => { const n = num(el.value); el.value = n ? fmt(n) : ''; });

  /* ---------- Formularios ---------- */
  function openExpense(existing) {
    const st = { cat: existing ? existing.cat : S.last.cat, method: existing ? existing.method : S.last.method };
    const dateVal = ymd(existing ? new Date(existing.ts) : new Date());
    openSheet(`<h2>${existing ? 'Editar gasto' : 'Nuevo gasto'}</h2>
      <label class="amt-in"><span>$</span><input id="f-amt" inputmode="numeric" autocomplete="off" placeholder="0" aria-label="Monto" value="${existing ? fmt(existing.amount) : ''}"></label>
      <div class="lbl">Categoría</div><div class="chips" id="f-cats">${CATS.map((c) => `<button type="button" class="chip" data-cat="${c.id}" aria-pressed="${c.id === st.cat}">${c.ico} ${esc(c.name)}</button>`).join('')}</div>
      <div class="lbl">Pagué con</div><div class="chips" id="f-methods">${METHODS.map((m) => `<button type="button" class="chip" data-method="${m.id}" aria-pressed="${m.id === st.method}">${esc(m.name)}</button>`).join('')}</div>
      <label class="field" style="margin-top:14px"><span>Nota (opcional)</span><input id="f-note" maxlength="60" placeholder="Ej: almuerzo, Uber a casa…" value="${esc(existing ? existing.note : '')}"></label>
      <label class="field"><span>Fecha</span><input id="f-date" type="date" value="${dateVal}"></label>
      <div class="row">${existing ? '<button class="btn danger" id="f-del">Eliminar</button>' : '<button class="btn" data-act="close">Cancelar</button>'}<button class="btn primary" id="f-save">Guardar</button></div>`);
    const body = $('#sheet-body');
    const amt = $('#f-amt'); moneyInput(amt);
    if (!existing) setTimeout(() => amt.focus(), 60);
    const pick = (sel, attr, key) => body.querySelectorAll(sel).forEach((b) => b.addEventListener('click', () => {
      st[key] = b.dataset[attr];
      body.querySelectorAll(sel).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }));
    pick('[data-cat]', 'cat', 'cat'); pick('[data-method]', 'method', 'method');

    $('#f-save').addEventListener('click', () => {
      const amount = num(amt.value);
      if (!amount) { amt.focus(); toast('Escribe el monto'); return; }
      const d = parseYmd($('#f-date').value || ymd(new Date()));
      const now = new Date();
      const ts = ymd(d) === ymd(now) ? +now : +new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
      const rec = { id: existing ? existing.id : uid(), ts: existing && ymd(new Date(existing.ts)) === ymd(d) ? existing.ts : ts, amount, cat: st.cat, method: st.method, note: $('#f-note').value.trim() };
      if (existing) S.expenses = S.expenses.map((e) => (e.id === existing.id ? rec : e)); else S.expenses.push(rec);
      S.last = { cat: st.cat, method: st.method };
      save(); closeSheet(); render(true);
      const { p } = budgetPeriod(), b = budget(p), ws = weekStart();
      const left = b.weekly - total(expIn(ws, addDays(ws, 7)));
      toast(S.settings.income > 0 ? `Guardado ${clp(amount)} · te quedan ${clp(left)} esta semana` : `Guardado ${clp(amount)}`,
        existing ? null : () => { S.expenses = S.expenses.filter((e) => e.id !== rec.id); save(); render(true); });
    });
    const del = $('#f-del');
    if (del) del.addEventListener('click', () => {
      const old = existing;
      S.expenses = S.expenses.filter((e) => e.id !== old.id); save(); closeSheet(); render(true);
      toast('Gasto eliminado', () => { S.expenses.push(old); save(); render(true); });
    });
  }

  // Formulario genérico para metas, fijos y cuotas
  function openForm({ title, fields, onSave, onDelete }) {
    openSheet(`<h2>${esc(title)}</h2>` + fields.map((f) =>
      `<label class="field"><span>${esc(f.label)}</span><input id="ff-${f.key}" type="${f.type || 'text'}" ${f.money ? 'inputmode="numeric" autocomplete="off"' : ''} placeholder="${esc(f.ph || '')}" value="${esc(f.money ? (f.value ? fmt(f.value) : '') : f.value == null ? '' : f.value)}"></label>`).join('') +
      `<div class="row">${onDelete ? '<button class="btn danger" id="ff-del">Eliminar</button>' : '<button class="btn" data-act="close">Cancelar</button>'}<button class="btn primary" id="ff-save">Guardar</button></div>`);
    fields.filter((f) => f.money).forEach((f) => moneyInput($('#ff-' + f.key)));
    $('#ff-save').addEventListener('click', () => {
      const v = {};
      fields.forEach((f) => { const raw = $('#ff-' + f.key).value; v[f.key] = f.money ? num(raw) : raw.trim(); });
      if (fields[0] && fields[0].required && !v[fields[0].key]) { toast('Falta el nombre'); return; }
      onSave(v); save(); closeSheet(); render(true);
    });
    if (onDelete) $('#ff-del').addEventListener('click', () => { if (confirm('¿Eliminar?')) { onDelete(); save(); closeSheet(); render(true); } });
  }

  const editGoal = (g) => openForm({
    title: g ? 'Editar meta' : 'Nueva meta',
    fields: [
      { key: 'name', label: 'Nombre', value: g && g.name, ph: 'Ej: Torres del Paine', required: true },
      { key: 'target', label: 'Monto objetivo ($, vacío si no lo sabes)', money: true, value: g && g.target },
      { key: 'saved', label: 'Ahorrado hasta hoy ($)', money: true, value: g && g.saved },
      { key: 'monthly', label: 'Aporte mensual ($)', money: true, value: g && g.monthly },
      { key: 'deadline', label: 'Fecha límite (opcional)', type: 'month', value: g && g.deadline },
      { key: 'account', label: 'Dónde está la plata', value: g && g.account, ph: 'Ej: Platino BancoEstado' },
    ],
    onSave: (v) => { const rec = { id: g ? g.id : uid(), ...v }; S.goals = g ? S.goals.map((x) => (x.id === g.id ? rec : x)) : [...S.goals, rec]; },
    onDelete: g ? () => { S.goals = S.goals.filter((x) => x.id !== g.id); } : null,
  });

  const editFixed = (f) => openForm({
    title: f ? 'Editar gasto fijo' : 'Nuevo gasto fijo',
    fields: [{ key: 'name', label: 'Nombre', value: f && f.name, ph: 'Ej: Diezmo', required: true }, { key: 'amount', label: 'Monto mensual ($)', money: true, value: f && f.amount }],
    onSave: (v) => { const rec = { id: f ? f.id : uid(), ...v }; S.fixed = f ? S.fixed.map((x) => (x.id === f.id ? rec : x)) : [...S.fixed, rec]; },
    onDelete: f ? () => { S.fixed = S.fixed.filter((x) => x.id !== f.id); } : null,
  });

  const editCmr = (c) => {
    const d = new Date(); d.setMonth(d.getMonth() + 1);
    openForm({
      title: c ? 'Editar cuota' : 'Nueva cuota CMR',
      fields: [
        { key: 'name', label: 'Descripción', value: c && c.name, ph: 'Ej: Sodimac 3/3', required: true },
        { key: 'amount', label: 'Monto de la cuota ($)', money: true, value: c && c.amount },
        { key: 'month', label: 'Mes de vencimiento', type: 'month', value: c ? c.month : d.getFullYear() + '-' + pad(d.getMonth() + 1) },
      ],
      onSave: (v) => { const rec = { id: c ? c.id : uid(), ...v }; S.cmr.items = c ? S.cmr.items.map((x) => (x.id === c.id ? rec : x)) : [...S.cmr.items, rec]; },
      onDelete: c ? () => { S.cmr.items = S.cmr.items.filter((x) => x.id !== c.id); } : null,
    });
  };

  /* ---------- Datos: exportar / importar ---------- */
  function exportData() {
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mis-finanzas-' + ymd(new Date()) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  $('#file-import').addEventListener('change', (ev) => {
    const f = ev.target.files[0]; ev.target.value = '';
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        if (!data || data.v !== 1) throw new Error('formato');
        if (!confirm('Esto reemplaza los datos que tienes en este dispositivo. ¿Continuar?')) return;
        S = normalize(data); save(); render(); toast('Datos importados');
      } catch (e) { toast('Ese archivo no es un respaldo válido'); }
    };
    r.readAsText(f);
  });

  /* ---------- Eventos ---------- */
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const id = el.dataset.id;
    switch (el.dataset.act) {
      case 'add': openExpense(); break;
      case 'close': closeSheet(); break;
      case 'undo': { const t = $('#toast'); if (t._undo) t._undo(); t.hidden = true; break; }
      case 'edit-exp': openExpense(S.expenses.find((x) => x.id === id)); break;
      case 'gmode': G.mode = id; render(true); break;
      case 'gper': G.off = Math.min(0, G.off + Number(id)); render(true); break;
      case 'goal-new': editGoal(); break;
      case 'goal-edit': editGoal(S.goals.find((x) => x.id === id)); break;
      case 'goal-add': {
        const g = S.goals.find((x) => x.id === id);
        openForm({ title: 'Abonar a ' + g.name, fields: [{ key: 'amount', label: 'Monto ($)', money: true, value: g.monthly || '' }],
          onSave: (v) => { g.saved += v.amount; toast(`Abonaste ${clp(v.amount)} a ${g.name}`); } });
        break;
      }
      case 'saved-ok': {
        const g = S.goals.find((x) => x.id === id); const pk = el.dataset.pk;
        g.saved += g.monthly; (S.done[pk] = S.done[pk] || []).push(g.id); save(); render(true);
        toast(`Anotado: ${clp(g.monthly)} a ${g.name}`, () => { g.saved -= g.monthly; S.done[pk] = S.done[pk].filter((x) => x !== g.id); save(); render(true); });
        break;
      }
      case 'fixed-new': editFixed(); break;
      case 'fixed-edit': editFixed(S.fixed.find((x) => x.id === id)); break;
      case 'cmr-new': editCmr(); break;
      case 'cmr-edit': editCmr(S.cmr.items.find((x) => x.id === id)); break;
      case 'export': exportData(); break;
      case 'import': $('#file-import').click(); break;
      case 'reset':
        if (confirm('¿Borrar TODOS los datos de este dispositivo? Esto no se puede deshacer.')) { S = defaults(); save(); render(); toast('Datos borrados'); }
        break;
    }
  });

  // Ajustes en la vista Plan (se guardan al salir del campo)
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-set]');
    if (!el) return;
    const [group, key] = el.dataset.set.split('.');
    const target = group === 'cmr' ? S.cmr : S.settings;
    if (key === 'planStart') target[key] = el.value;
    else {
      let v = num(el.value);
      if (key === 'payday' || key === 'cmrClose' || key === 'cmrDue') v = Math.min(28, Math.max(1, v || 1));
      if (key === 'savingsPct') v = Math.min(90, v);
      target[key] = v;
    }
    if (key === 'income' && S.settings.income > 0) S.settings.setupDone = true;
    save(); render(true);
  });
  document.addEventListener('input', (e) => {
    const el = e.target.closest('[data-set]');
    if (el && (el.dataset.set === 'settings.income' || el.dataset.set === 'cmr.fees' || el.dataset.set === 'settings.hormigaMax')) {
      const n = num(el.value); el.value = n ? fmt(n) : '';
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

  /* ---------- Inicio ---------- */
  const startWithAdd = location.hash === '#add';
  if (startWithAdd) history.replaceState(null, '', '#/inicio');
  render();
  if (startWithAdd) openExpense();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && $('#sheet').hidden) render(true); });

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && location.hostname !== 'localhost') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
