import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, BarChart3, Check, CircleHelp, Download, LineChart as LineIcon, PieChart as PieIcon, Save, ScatterChart as ScatterIcon, SlidersHorizontal, Sparkles } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';
import { api, formatCurrency, type Dataset } from '../api';

type Point = Record<string, string | number>;
type SavedChart = { id: string; name: string; datasetId: string; config: Record<string, string> };
type ChartKind = 'bar' | 'line' | 'pie' | 'scatter' | 'histogram';

const chartTypes: Array<{ key: ChartKind; name: string; icon: typeof BarChart3 }> = [
  { key: 'bar', name: 'Bar', icon: BarChart3 },
  { key: 'line', name: 'Line', icon: LineIcon },
  { key: 'pie', name: 'Pie', icon: PieIcon },
  { key: 'scatter', name: 'Scatter', icon: ScatterIcon },
  { key: 'histogram', name: 'Histogram', icon: BarChart3 },
];
const palette = ['#6377db', '#db8068', '#62a88e', '#d2a84d', '#6593a3', '#a67db1', '#95a076'];
const safeIdentifier = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;
const escapeValue = (value: string) => `'${value.replaceAll("'", "''")}'`;

export default function Studio() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [kind, setKind] = useState<ChartKind>('bar');
  const [groupField, setGroupField] = useState('');
  const [valueField, setValueField] = useState('');
  const [secondField, setSecondField] = useState('');
  const [filterField, setFilterField] = useState('');
  const [filterValue, setFilterValue] = useState('');
  const [title, setTitle] = useState('Revenue by category');
  const [points, setPoints] = useState<Point[]>([]);
  const [saved, setSaved] = useState<SavedChart[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pendingSavedChart = useRef(false);
  const [savedChartVersion, setSavedChartVersion] = useState(0);
  const active = datasets.find((dataset) => dataset.id === selectedId) ?? null;
  const numericFields = active?.columns.filter((column) => column.type === 'number') ?? [];
  const groupFields = active?.columns.filter((column) => column.type !== 'number') ?? [];

  useEffect(() => {
    Promise.all([api<{ datasets: Dataset[] }>('/datasets'), api<{ charts: SavedChart[] }>('/charts')]).then(([datasetData, chartData]) => {
      setDatasets(datasetData.datasets);
      setSaved(chartData.charts);
      const dataset = datasetData.datasets[0];
      if (dataset) {
        setSelectedId(dataset.id);
        setGroupField(dataset.mappings.category ?? dataset.columns.find((column) => column.type !== 'number')?.key ?? '');
        setValueField(dataset.mappings.revenue ?? dataset.columns.find((column) => column.type === 'number')?.key ?? '');
        setSecondField(dataset.columns.filter((column) => column.type === 'number')[1]?.key ?? '');
      }
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load chart studio.'));
  }, []);

  const sql = useMemo(() => {
    if (!active) return '';
    const filter = filterField && filterValue ? ` WHERE ${safeIdentifier(filterField)} = ${escapeValue(filterValue)}` : '';
    if (kind === 'scatter') return `SELECT ${safeIdentifier(valueField)} AS x, ${safeIdentifier(secondField)} AS y FROM ${active.tableName}${filter} LIMIT 200`;
    if (kind === 'histogram') return `SELECT CAST(${safeIdentifier(valueField)} / 50 AS INTEGER) * 50 AS bucket, COUNT(*) AS count FROM ${active.tableName}${filter} GROUP BY bucket ORDER BY bucket LIMIT 50`;
    const groupExpression = kind === 'line' && active.columns.find((column) => column.key === groupField)?.type === 'date'
      ? `substr(${safeIdentifier(groupField)}, 1, 7)`
      : safeIdentifier(groupField);
    return `SELECT ${groupExpression} AS label, SUM(${safeIdentifier(valueField)}) AS value FROM ${active.tableName}${filter} GROUP BY label ORDER BY value DESC LIMIT 50`;
  }, [active, filterField, filterValue, groupField, kind, secondField, valueField]);

  async function runChart() {
    if (!active || !valueField || (kind !== 'scatter' && !groupField) || (kind === 'scatter' && !secondField)) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ rows: Point[] }>('/sql', { method: 'POST', body: JSON.stringify({ sql, datasetId: active.id }) });
      setPoints(result.rows);
      if (!result.rows.length) setNotice('No records match the selected chart fields and filter.');
      else setNotice('Chart refreshed from the selected dataset.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Chart could not be generated.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (pendingSavedChart.current) {
      pendingSavedChart.current = false;
      void runChart();
      return;
    }
    if (active && groupField && valueField) void runChart();
  }, [selectedId, savedChartVersion]);

  const handleDatasetChange = (id: string) => {
    const dataset = datasets.find((item) => item.id === id);
    setSelectedId(id);
    setGroupField(dataset?.mappings.category ?? dataset?.columns.find((column) => column.type !== 'number')?.key ?? '');
    setValueField(dataset?.mappings.revenue ?? dataset?.columns.find((column) => column.type === 'number')?.key ?? '');
    setSecondField(dataset?.columns.filter((column) => column.type === 'number')[1]?.key ?? '');
  };

  async function saveChart() {
    if (!active) return;
    setError('');
    try {
      await api('/charts', { method: 'POST', body: JSON.stringify({ datasetId: active.id, name: title, config: { kind, groupField, valueField, secondField, filterField, filterValue, title } }) });
      const { charts } = await api<{ charts: SavedChart[] }>('/charts');
      setSaved(charts);
      setNotice('Chart configuration saved to your workspace.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Chart could not be saved.');
    }
  }

  function loadSaved(chart: SavedChart) {
    const config = chart.config;
    handleDatasetChange(chart.datasetId);
    setTitle(chart.name);
    setKind((config.kind as ChartKind) ?? 'bar');
    setGroupField(config.groupField ?? '');
    setValueField(config.valueField ?? '');
    setSecondField(config.secondField ?? '');
    setFilterField(config.filterField ?? '');
    setFilterValue(config.filterValue ?? '');
    pendingSavedChart.current = true;
    setSavedChartVersion((version) => version + 1);
  }

  function exportSvg() {
    const svg = document.querySelector('.studio-chart svg')?.outerHTML;
    if (!svg) return setError('Generate a chart before exporting it.');
    const source = svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
    const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'insightbi-chart'}.svg`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="page-stack studio-page">
      <div className="page-heading"><div><div className="eyebrow">MAKE THE SIGNAL VISIBLE</div><h1>Visualization studio</h1><p>Build a chart from your data. Every point traces back to its source.</p></div><div className="studio-heading-actions"><button className="button button-secondary" onClick={saveChart} disabled={!active || !points.length}><Save size={15} />Save chart</button><button className="button button-primary" onClick={runChart} disabled={!active || busy}><Sparkles size={15} />{busy ? 'Building…' : 'Build visualization'}</button></div></div>
      {error && <div className="inline-error page-error" role="alert">{error}</div>}{notice && <div className="studio-notice"><Check size={14} />{notice}<button onClick={() => setNotice('')} aria-label="Dismiss">×</button></div>}
      {!datasets.length ? <section className="empty-state"><div className="empty-icon"><BarChart3 size={22} /></div><h2>A chart needs data.</h2><p>Upload a dataset first. Your visualizations will be built from its actual rows.</p><a className="button button-primary" href="/app/datasets">Go to datasets</a></section> : <div className="studio-layout"><section className="panel chart-builder"><div className="builder-heading"><span className="panel-kicker">CONFIGURE VISUAL</span><h2>Chart settings</h2><p>Pick a dataset, then choose the fields to compare.</p></div><label className="field-label">Dataset<select value={selectedId} onChange={(event) => handleDatasetChange(event.target.value)}>{datasets.map((dataset) => <option value={dataset.id} key={dataset.id}>{dataset.name}{dataset.isSynthetic ? ' · Demo' : ''}</option>)}</select></label><div className="field-label"><span>Chart type</span><div className="chart-type-control">{chartTypes.map(({ key, name, icon: Icon }) => <button key={key} className={kind === key ? 'selected' : ''} onClick={() => setKind(key)} aria-label={`${name} chart`} aria-pressed={kind === key}><Icon size={16} /><span>{name}</span></button>)}</div></div>{kind === 'scatter' ? <><label className="field-label">X axis<select value={valueField} onChange={(event) => setValueField(event.target.value)}>{numericFields.map((field) => <option value={field.key} key={field.key}>{field.name}</option>)}</select></label><label className="field-label">Y axis<select value={secondField} onChange={(event) => setSecondField(event.target.value)}>{numericFields.map((field) => <option value={field.key} key={field.key}>{field.name}</option>)}</select></label></> : <><label className="field-label">Group by<select value={groupField} onChange={(event) => setGroupField(event.target.value)}>{groupFields.map((field) => <option value={field.key} key={field.key}>{field.name} · {field.type}</option>)}</select></label><label className="field-label">Measure<select value={valueField} onChange={(event) => setValueField(event.target.value)}>{numericFields.map((field) => <option value={field.key} key={field.key}>{field.name}</option>)}</select></label></>}
          <label className="field-label">Chart title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} /></label><div className="builder-divider" /><div className="filter-label"><span>Optional filter</span><span title="Exact match filter for a categorical field."><CircleHelp size={13} /></span></div><label className="field-label field-label-compact">Field<select value={filterField} onChange={(event) => setFilterField(event.target.value)}><option value="">No filter</option>{active?.columns.map((field) => <option value={field.key} key={field.key}>{field.name}</option>)}</select></label><label className="field-label field-label-compact">Matches<input value={filterValue} onChange={(event) => setFilterValue(event.target.value)} placeholder="Exact value" disabled={!filterField} /></label><button className="button button-primary builder-run" onClick={runChart} disabled={!active || busy}><Sparkles size={15} />{busy ? 'Building…' : 'Update chart'}</button>
        </section><div className="studio-main"><section className="panel chart-preview-panel"><div className="chart-preview-header"><div><span className="panel-kicker">LIVE PREVIEW</span><h2>{title || 'Untitled chart'}</h2><p>{active?.name} · {valueField ? active?.columns.find((column) => column.key === valueField)?.name : 'Select a measure'}{groupField ? ` by ${active?.columns.find((column) => column.key === groupField)?.name}` : ''}</p></div><div className="chart-export-buttons"><button className="icon-button" title="Download SVG chart" onClick={exportSvg}><Download size={15} /></button><button className="icon-button" title="Refresh chart" onClick={runChart}><ArrowDownToLine size={15} /></button></div></div><div className="studio-chart">{points.length ? <ResponsiveContainer width="100%" height="100%">{kind === 'bar' ? <BarChart data={points} margin={{ top: 16, right: 12, bottom: 12, left: 0 }}><CartesianGrid strokeDasharray="2 5" vertical={false} stroke="var(--grid-line)" /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} interval={0} angle={points.length > 7 ? -24 : 0} textAnchor={points.length > 7 ? 'end' : 'middle'} height={points.length > 7 ? 55 : 30} /><YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'var(--text-faint)' }} /><Tooltip formatter={(value) => [formatCurrency(Number(value)), 'Total']} /><Bar dataKey="value" radius={[3, 3, 0, 0]}>{points.map((point, index) => <Cell key={String(point.label)} fill={palette[index % palette.length]} />)}</Bar></BarChart> : kind === 'line' ? <LineChart data={points} margin={{ top: 16, right: 12, bottom: 4, left: 0 }}><CartesianGrid strokeDasharray="2 5" vertical={false} stroke="var(--grid-line)" /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} /><YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'var(--text-faint)' }} /><Tooltip formatter={(value) => [formatCurrency(Number(value)), 'Total']} /><Line type="monotone" dataKey="value" stroke="#6377db" strokeWidth={2.5} dot={{ fill: '#fff', stroke: '#6377db', strokeWidth: 2, r: 3 }} /></LineChart> : kind === 'pie' ? <PieChart><Tooltip formatter={(value) => [formatCurrency(Number(value)), 'Total']} /><Pie data={points} dataKey="value" nameKey="label" innerRadius="45%" outerRadius="75%" paddingAngle={3}>{points.map((point, index) => <Cell key={String(point.label)} fill={palette[index % palette.length]} />)}</Pie></PieChart> : kind === 'scatter' ? <ScatterChart margin={{ top: 15, right: 15, bottom: 15, left: 5 }}><CartesianGrid strokeDasharray="2 5" stroke="var(--grid-line)" /><XAxis type="number" dataKey="x" name={valueField} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} /><YAxis type="number" dataKey="y" name={secondField} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} /><Tooltip cursor={{ strokeDasharray: '3 3' }} /><Scatter data={points} fill="#6377db" /></ScatterChart> : <BarChart data={points} margin={{ top: 16, right: 12, bottom: 12, left: 0 }}><CartesianGrid strokeDasharray="2 5" vertical={false} stroke="var(--grid-line)" /><XAxis dataKey="bucket" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} /><YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'var(--text-faint)' }} /><Tooltip /><Bar dataKey="count" fill="#62a88e" radius={[3, 3, 0, 0]} /></BarChart>}</ResponsiveContainer> : <div className="chart-empty"><BarChart3 size={23} /><span>Choose fields and build a chart to see it here.</span></div>}</div><div className="chart-preview-footer"><span><i className="footnote-dot" /> Source: {active?.tableName}</span><span>{points.length ? `${points.length} plotted points` : 'No chart generated'}</span></div></section><section className="panel saved-chart-panel"><div className="panel-heading"><div><span className="panel-kicker">YOUR WORKSPACE</span><h2>Saved charts</h2></div><span className="saved-count">{saved.length}</span></div>{saved.length ? <div className="saved-chart-list">{saved.map((chart) => <button key={chart.id} className="saved-chart-item" onClick={() => loadSaved(chart)}><span className="saved-chart-icon"><BarChart3 size={16} /></span><span><strong>{chart.name}</strong><small>{datasets.find((item) => item.id === chart.datasetId)?.name ?? 'Dataset'}</small></span><Download size={14} /></button>)}</div> : <div className="saved-empty">Saved chart configurations will appear here.</div>}</section></div></div>}</div>
  );
}