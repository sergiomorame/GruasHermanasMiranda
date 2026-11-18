/* =========================================================
   charts.js — gráficas con Chart.js: km por entidad,
   distribución por distancia al corralón y longitud por ruta.
   Expone: GHM.charts
   ========================================================= */
(function (GHM) {
  'use strict';

  const charts = {};
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  function theme() {
    Chart.defaults.font.family = css('--font-sans') || 'sans-serif';
    Chart.defaults.font.size = 11.5;
    Chart.defaults.color = css('--fg-muted');
    Chart.defaults.borderColor = css('--line');
  }

  function tooltip() {
    return {
      backgroundColor: css('--panel'), titleColor: css('--fg'), bodyColor: css('--fg'),
      borderColor: css('--line-strong'), borderWidth: 1, padding: 9, boxPadding: 4, cornerRadius: 6
    };
  }

  function upsert(id, config) {
    if (charts[id]) { charts[id].destroy(); }
    const el = document.getElementById(id);
    if (!el) return;
    charts[id] = new Chart(el, config);
  }

  /** Dona: km concesionados por entidad (tramos sin traslape del ámbito). */
  function entidad(rows) {
    upsert('ch-entidad', {
      type: 'doughnut',
      data: {labels: rows.map((r) => r.entidad), datasets: [{data: rows.map((r) => r.km), backgroundColor: [css('--accent'), css('--road'), css('--line-strong')], borderColor: css('--panel'), borderWidth: 3, hoverOffset: 6}]},
      options: {
        maintainAspectRatio: false, cutout: '64%',
        plugins: {
          legend: {position: 'bottom', labels: {boxWidth: 10, boxHeight: 10, color: css('--fg'), generateLabels: (ch) => {
            const tot = rows.reduce((a, r) => a + r.km, 0) || 1;
            return rows.map((r, i) => ({text: `${r.entidad}  ${GHM.fmt.km(r.km)} km · ${GHM.fmt.pct(r.km / tot)}`, fillStyle: ch.data.datasets[0].backgroundColor[i], strokeStyle: 'transparent', index: i, fontColor: css('--fg')}));
          }}},
          tooltip: {...tooltip(), callbacks: {label: (c) => ` ${GHM.fmt.km(c.raw)} km`}}
        }
      }
    });
  }

  /** Barras: km de ruta por banda de distancia al corralón más cercano. */
  function bandas(rows) {
    const colors = [css('--ok'), css('--teal'), css('--warn'), css('--bad')];
    upsert('ch-bandas', {
      type: 'bar',
      data: {labels: rows.map((r) => r.label), datasets: [{data: rows.map((r) => r.km), backgroundColor: colors, borderRadius: 4, maxBarThickness: 42}]},
      options: {
        maintainAspectRatio: false,
        plugins: {legend: {display: false}, tooltip: {...tooltip(), callbacks: {label: (c) => ` ${GHM.fmt.km(c.raw)} km de ruta`}}},
        scales: {
          x: {grid: {display: false}},
          y: {beginAtZero: true, title: {display: true, text: 'km'}, grid: {color: css('--line')}, ticks: {maxTicksLimit: 5}}
        }
      }
    });
  }

  /** Barras horizontales: km declarados vs medidos por ruta. */
  function longitud(rows) {
    const wrap = document.getElementById('wrap-longitud');
    if (wrap) wrap.style.height = Math.max(220, rows.length * 24 + 70) + 'px';
    upsert('ch-longitud', {
      type: 'bar',
      data: {
        labels: rows.map((r) => `${r.clave}  ${r.nombre.length > 30 ? r.nombre.slice(0, 29) + '…' : r.nombre}`),
        datasets: [
          {label: 'Km declarados', data: rows.map((r) => r.longitud_km), backgroundColor: css('--line-strong'), borderRadius: 3, barPercentage: .9, categoryPercentage: .78},
          {label: 'Km medidos', data: rows.map((r) => r.km_medidos), backgroundColor: rows.map((r) => r.color), borderRadius: 3, barPercentage: .9, categoryPercentage: .78}
        ]
      },
      options: {
        indexAxis: 'y', maintainAspectRatio: false,
        plugins: {
          legend: {position: 'top', align: 'end', labels: {boxWidth: 10, boxHeight: 10, color: css('--fg')}},
          tooltip: {...tooltip(), callbacks: {
            label: (c) => ` ${c.dataset.label}: ${GHM.fmt.km(c.raw)} km`,
            afterBody: (items) => { const r = rows[items[0].dataIndex]; const dif = r.km_medidos - r.longitud_km; return `Diferencia: ${dif >= 0 ? '+' : ''}${GHM.fmt.km(dif)} km`; }
          }}
        },
        scales: {
          x: {beginAtZero: true, grid: {color: css('--line')}, title: {display: true, text: 'km'}},
          y: {grid: {display: false}, ticks: {autoSkip: false, color: css('--fg'), font: {size: 11}}}
        },
        onClick: (e, els) => { if (els.length) GHM.filters.set({ruta: String(rows[els[0].index].id)}); }
      }
    });
  }

  function retheme() { theme(); }

  GHM.charts = {theme, retheme, entidad, bandas, longitud};
})(window.GHM = window.GHM || {});
