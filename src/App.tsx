import { createContext, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import Papa from 'papaparse';
import {
  Activity, ArrowDownToLine, ArrowLeft, ArrowRight, BarChart3, BookOpen, Check, ChevronDown, ChevronLeft,
  CircleHelp, Cloud, Database, Download, FileBarChart, FileSpreadsheet, Filter, FolderKanban, Gauge,
  LayoutDashboard, LogOut, Menu, Moon, MoreHorizontal, Plus, Search, Settings2, ShieldCheck, Sparkles,
  Sun, Table2, Trash2, Upload, Users, WandSparkles, X,
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import Studio from './pages/Studio';
import {
  calculateMetrics, downloadText, exportCsv, formatCurrency, getDataQuality, importDataset, makeRetailSample,
  renameColumn, type DataRow, type Dataset,
} from './data';
import { runWorkspaceSql } from './api';
import {
  listDatasets, listProjects, listReports, removeDataset, removeProject,
  saveChart as persistChart, saveDataset, saveProject, saveReport, setWorkspaceNamespace, type Project, type SavedChart, type SavedReport,
} from './storage';
import { cloudAuthEnabled, deleteCloudRecord, saveCloudRecord, syncCloudMetadata, supabase } from './supabase';

type WorkspaceContextValue = {
  datasets: Dataset[];
  activeDataset: Dataset | null;
  setActiveDatasetId: (id: string) => void;
  updateDataset: (dataset: Dataset) => Promise<void>;
  addDataset: (dataset: Dataset) => Promise<void>;
  deleteDataset: (id: string) => Promise<void>;
  projects: Project[];
  addProject: (name: string, datasetId?: string) => Promise<void>;
  removeProjectById: (id: string) => Promise<void>;
  reports: SavedReport[];
  addReport: (report: SavedReport) => Promise<void>;
  user: { id: string; email?: string } | null;
  authLoading: boolean;
  signOut: () => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
const modules = [
  { id: 'sales', name: 'Sales & profitability', icon: Activity },
  { id: 'customers', name: 'Customer behavior', icon: Users },
  { id: 'ecommerce', name: 'E-commerce', icon: BarChart3 },
  { id: 'hr', name: 'People & attrition', icon: Gauge },
  { id: 'budget', name: 'Budget & expenses', icon: FileSpreadsheet },
  { id: 'students', name: 'Student performance', icon: BookOpen },
];

function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('Workspace context is missing.');
  return context;
}

function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [activeId, setActiveId] = useState(() => localStorage.getItem('insightbi-active-dataset') ?? '');
  const [user, setUser] = useState<WorkspaceContextValue['user']>(null);
  const [authLoading, setAuthLoading] = useState(cloudAuthEnabled);
  const activeDataset = datasets.find((dataset) => dataset.id === activeId) ?? datasets[0] ?? null;

  useEffect(() => {
    let active = true;
    let loadVersion = 0;
    const loadWorkspace = async (account: { id: string; email?: string } | null) => {
      const version = ++loadVersion;
      setAuthLoading(true);
      setUser(account);
      setWorkspaceNamespace(account?.id);
      try {
        const [savedDatasets, savedProjects, savedReports] = await Promise.all([listDatasets(), listProjects(), listReports()]);
        if (!active || version !== loadVersion) return;
        setDatasets(savedDatasets);
        setProjects(savedProjects);
        setReports(savedReports);
      } catch (error) {
        console.error(error);
      } finally {
        if (active && version === loadVersion) setAuthLoading(false);
      }
    };
    if (!supabase) {
      void loadWorkspace(null);
      return () => { active = false; };
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      void loadWorkspace(session?.user ? { id: session.user.id, email: session.user.email } : null);
    });
    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) { console.error(error); setAuthLoading(false); return; }
      void loadWorkspace(data.session?.user ? { id: data.session.user.id, email: data.session.user.email } : null);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (authLoading || !user || !supabase) return;
    syncCloudMetadata(user.id).then((metadata) => {
      if (!metadata) return;
      const { projects: cloudProjects, charts: cloudCharts, reports: cloudReports } = metadata;
      const savedCharts: SavedChart[] = cloudCharts.map((chart) => ({
        id: String(chart.id), name: String(chart.name), datasetId: String(chart.dataset_id),
        config: chart.config as Record<string, string>, createdAt: String(chart.created_at),
      }));
      const savedReports: SavedReport[] = cloudReports.map((report) => ({
        id: String(report.id), title: String(report.title), datasetId: String(report.dataset_id), createdAt: String(report.created_at),
      }));
      void Promise.all([...savedCharts.map((chart) => persistChart(chart)), ...savedReports.map((report) => saveReport(report))]);
      setReports((current) => [...savedReports.filter((report) => !current.some((item) => item.id === report.id)), ...current]);
      setProjects((current) => {
        const merged = new Map(current.map((project) => [project.id, project]));
        cloudProjects.forEach((project) => merged.set(String(project.id), {
          id: String(project.id), name: String(project.name), createdAt: String(project.created_at), datasetId: project.dataset_id ? String(project.dataset_id) : undefined,
        }));
        const values = [...merged.values()];
        void Promise.all(values.map((project) => saveProject(project)));
        return values;
      });
    }).catch((error: unknown) => console.warn('Cloud project history is unavailable:', error));
  }, [authLoading, user]);

  const setActiveDatasetId = (id: string) => {
    localStorage.setItem('insightbi-active-dataset', id);
    setActiveId(id);
  };
  const persistDataset = async (dataset: Dataset) => {
    await saveDataset(dataset);
    setDatasets((current) => [dataset, ...current.filter((item) => item.id !== dataset.id)]);
    setActiveDatasetId(dataset.id);
    if (user) {
      await saveCloudRecord('datasets', {
        id: dataset.id, user_id: user.id, name: dataset.name, table_name: dataset.tableName, row_count: dataset.rows.length,
        columns: dataset.columns, mappings: dataset.mappings, is_synthetic: dataset.isSynthetic, created_at: dataset.createdAt,
      });
    }
  };
  const addProject = async (name: string, datasetId?: string) => {
    const project = { id: crypto.randomUUID(), name: name.trim(), createdAt: new Date().toISOString(), datasetId };
    await saveProject(project);
    setProjects((current) => [project, ...current]);
    if (user) await saveCloudRecord('projects', { id: project.id, user_id: user.id, name: project.name, created_at: project.createdAt, dataset_id: datasetId ?? null });
  };
  const addReport = async (report: SavedReport) => {
    await saveReport(report);
    setReports((current) => [report, ...current]);
    if (user) await saveCloudRecord('reports', { id: report.id, user_id: user.id, title: report.title, dataset_id: report.datasetId, created_at: report.createdAt });
  };

  const value: WorkspaceContextValue = {
    datasets, activeDataset, setActiveDatasetId, updateDataset: persistDataset, addDataset: persistDataset,
    deleteDataset: async (id) => {
      await removeDataset(id);
      setDatasets((current) => current.filter((dataset) => dataset.id !== id));
      if (activeId === id) setActiveDatasetId('');
      if (user) await deleteCloudRecord('datasets', id);
    },
    projects, addProject, removeProjectById: async (id) => {
      await removeProject(id);
      setProjects((current) => current.filter((project) => project.id !== id));
      if (user && supabase) await supabase.from('projects').delete().eq('id', id);
    },
    reports, addReport, user, authLoading,
    signOut: async () => { if (supabase) await supabase.auth.signOut(); setUser(null); },
  };
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

function App() {
  return <WorkspaceProvider><Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/auth" element={<AuthPage />} />
    <Route path="/app" element={<ProtectedWorkspace />}>
      <Route index element={<DashboardPage />} />
      <Route path="datasets" element={<DatasetsPage />} />
      <Route path="sql" element={<SqlPage />} />
      <Route path="studio" element={<Studio />} />
      <Route path="modules/:moduleId" element={<ModulePage />} />
      <Route path="reports" element={<ReportsPage />} />
      <Route path="projects" element={<ProjectsPage />} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></WorkspaceProvider>;
}

function ProtectedWorkspace() {
  const { user, authLoading } = useWorkspace();
  if (authLoading) return <div className="screen-loading"><span className="loading-mark" />Restoring your workspace</div>;
  if (cloudAuthEnabled && !user) return <Navigate to="/auth" replace />;
  return <AppShell />;
}

function LandingPage() {
  const sample = useMemo(() => makeRetailSample(), []);
  const metrics = calculateMetrics(sample);
  return <div className="landing">
    <header className="landing-nav"><Link className="brand brand-dark" to="/"><span className="brand-mark"><BarChart3 size={19} /></span><span>insight<span>bi</span></span></Link><nav><a href="#workflow">Workflow</a><a href="#capabilities">Capabilities</a><Link to="/auth">Sign in</Link><Link className="button button-dark" to="/app">Open workspace<ArrowRight size={15} /></Link></nav></header>
    <main>
      <section className="landing-hero">
        <div className="hero-copy"><span className="eyebrow"><span className="eyebrow-dot" />BUSINESS ANALYTICS, WITHOUT THE BUSYWORK</span><h1>Your data has<br />a point of view.</h1><p>Bring spreadsheets, questions, and a little curiosity. Leave with analysis you can explain.</p><div className="hero-actions"><Link className="button button-dark button-large" to="/app">Start analyzing<ArrowRight size={16} /></Link><a className="text-action" href="#workflow">See how it works<ArrowDownToLine size={15} /></a></div><div className="hero-note"><ShieldCheck size={15} />Your uploaded data stays in this browser unless you configure Supabase.</div></div>
        <div className="hero-visual"><div className="visual-topline"><div><span className="panel-kicker">SAMPLE WORKSPACE</span><h2>Retail pulse</h2></div><span className="synthetic-tag"><span />Synthetic sample</span></div><div className="visual-kpis"><div><small>Net sales</small><strong>{formatCurrency(metrics.revenue)}</strong><span>480 sample orders</span></div><div><small>Profit margin</small><strong>{metrics.margin.toFixed(1)}%</strong><span>Sales less product cost</span></div></div><div className="landing-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={metrics.months} margin={{ top: 10, right: 3, bottom: 0, left: 0 }}><defs><linearGradient id="sampleFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#89a0ff" stopOpacity={0.24} /><stop offset="100%" stopColor="#89a0ff" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="#26354b" strokeDasharray="2 5" vertical={false} /><XAxis dataKey="month" tickFormatter={(value: string) => value.slice(5)} tick={{ fontSize: 10, fill: '#8b98ab' }} axisLine={false} tickLine={false} interval={5} /><YAxis hide /><Tooltip formatter={(value) => [formatCurrency(Number(value)), 'Sales']} contentStyle={{ background: '#18263a', border: '1px solid #2b3a50', borderRadius: 4 }} /><Area dataKey="value" type="monotone" stroke="#a8b7ff" strokeWidth={2} fill="url(#sampleFill)" /></AreaChart></ResponsiveContainer></div><div className="visual-foot"><span>Revenue trend · monthly</span><span>Illustrative data, generated locally</span></div></div>
      </section>
      <section className="landing-proof"><span>FROM A RAW FILE TO A CLEAR NEXT STEP</span><span><Database size={15} />CSV & Excel</span><span><ShieldCheck size={15} />Private by default</span><span><Activity size={15} />Analysis you can trace</span></section>
      <section className="landing-section" id="capabilities"><div className="section-intro"><span className="eyebrow">ONE WORKSPACE, END TO END</span><h2>From the first row<br />to the final readout.</h2><p>Keep the source, the analysis, and the decision in the same place.</p></div><div className="capability-grid"><Feature icon={<Table2 />} number="01" title="Make the data usable" text="Preview, profile, filter, rename, and export your CSV and Excel data." /><Feature icon={<WandSparkles />} number="02" title="Ask better questions" text="Query isolated datasets with read-only SQL, then shape the result into a chart." /><Feature icon={<FileBarChart />} number="03" title="Share the reasoning" text="Turn computed KPIs and findings into a report you can save or print." /></div></section>
      <section className="workflow-section" id="workflow"><div className="workflow-heading"><span className="eyebrow">A PRACTICAL WORKFLOW</span><h2>Simple enough to start.<br />Serious enough to trust.</h2></div><div className="workflow-steps"><div><span>01</span><h3>Bring a file</h3><p>Upload CSV or Excel, or start with a labeled synthetic retail sample.</p></div><div><span>02</span><h3>Explore the shape</h3><p>Check types, missing values, duplicates, trends, and outliers in context.</p></div><div><span>03</span><h3>Build the case</h3><p>Save a chart, write down the finding, and export the report.</p></div></div></section>
    </main>
    <footer className="landing-footer"><Link className="brand brand-dark" to="/"><span className="brand-mark"><BarChart3 size={17} /></span><span>insight<span>bi</span></span></Link><span>Clear work, grounded in your data.</span><Link to="/app">Open your workspace <ArrowRight size={14} /></Link></footer>
  </div>;
}

function Feature({ icon, number, title, text }: { icon: ReactNode; number: string; title: string; text: string }) {
  return <article className="feature"><div className="feature-top"><span className="feature-icon">{icon}</span><span>{number}</span></div><h3>{title}</h3><p>{text}</p></article>;
}

function AuthPage() {
  const { user } = useWorkspace();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register' | 'recover' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setMode('reset');
    });
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (mode === 'reset' && user?.email) setEmail(user.email);
  }, [mode, user]);
  if (user && mode !== 'reset') return <Navigate to="/app" replace />;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(''); setNotice('');
    if (!supabase) return;
    setBusy(true);
    try {
      if (mode === 'register') {
        const { error: authError } = await supabase.auth.signUp({ email, password });
        if (authError) throw authError;
        setNotice('Check your email to confirm your account, then sign in.');
      } else if (mode === 'recover') {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth` });
        if (authError) throw authError;
        setNotice('Password reset instructions have been sent to your email.');
      } else if (mode === 'reset') {
        const { error: authError } = await supabase.auth.updateUser({ password });
        if (authError) throw authError;
        await supabase.auth.signOut();
        setNotice('Your password has been updated. Sign in with the new password.');
        setPassword('');
        setMode('login');
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) throw authError;
        navigate('/app');
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Authentication could not be completed.'); }
    finally { setBusy(false); }
  }
  return <main className="auth-screen"><Link className="brand brand-dark auth-brand" to="/"><span className="brand-mark"><BarChart3 size={19} /></span><span>insight<span>bi</span></span></Link><section className="auth-panel"><span className="eyebrow">YOUR ANALYTICS WORKSPACE</span><h1>{mode === 'register' ? 'Create your account' : mode === 'recover' ? 'Reset your password' : mode === 'reset' ? 'Choose a new password' : 'Welcome back'}</h1><p>{mode === 'register' ? 'One account for your projects and saved analysis.' : mode === 'recover' ? 'We’ll send a reset link to your inbox.' : mode === 'reset' ? 'Set a new password for your account.' : 'Sign in to pick up where you left off.'}</p>{!cloudAuthEnabled ? <div className="setup-notice"><Cloud size={18} /><div><strong>Cloud sign-in is not configured.</strong><span>Add the Supabase URL and anon key to your environment to enable accounts. You can still use the local workspace in this browser.</span></div></div> : null}
    <form onSubmit={submit}><label className="field-label">Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={mode === 'reset'} /></label>{mode !== 'recover' && <label className="field-label">Password<input type="password" autoComplete={mode === 'register' || mode === 'reset' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>}{error && <div className="inline-error" role="alert">{error}</div>}{notice && <div className="inline-notice" role="status">{notice}</div>}<button className="button button-dark auth-submit" disabled={busy || !cloudAuthEnabled}>{busy ? 'Working…' : mode === 'register' ? 'Create account' : mode === 'recover' ? 'Send reset link' : mode === 'reset' ? 'Update password' : 'Sign in'}<ArrowRight size={15} /></button></form>
    {cloudAuthEnabled && <div className="auth-switch">{mode === 'login' ? <><button onClick={() => setMode('recover')}>Forgot password?</button><span>New here? <button onClick={() => setMode('register')}>Create an account</button></span></> : <button onClick={() => setMode('login')}><ArrowLeft size={14} /> Back to sign in</button>}</div>}<Link className="auth-local-link" to="/app">Continue to local workspace<ArrowRight size={14} /></Link></section><div className="auth-foot">InsightBI · Your files stay on this device unless cloud storage is configured.</div></main>;
}

function AppShell() {
  const { user, signOut } = useWorkspace();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem('insightbi-theme') === 'dark');
  useEffect(() => { localStorage.setItem('insightbi-theme', dark ? 'dark' : 'light'); }, [dark]);
  useEffect(() => setMobileOpen(false), [location.pathname]);
  const currentLabel = location.pathname === '/app' ? 'Overview' : location.pathname.includes('datasets') ? 'Datasets' : location.pathname.includes('sql') ? 'SQL laboratory' : location.pathname.includes('studio') ? 'Visualization studio' : location.pathname.includes('modules') ? 'Analysis workspace' : location.pathname.includes('reports') ? 'Reports' : 'Projects';
  const mainLinks = [
    { to: '/app', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/app/datasets', label: 'Datasets', icon: Database },
    { to: '/app/sql', label: 'SQL laboratory', icon: TerminalIcon },
    { to: '/app/studio', label: 'Visualization studio', icon: BarChart3 },
  ];
  return <div className={`app-shell ${collapsed ? 'is-collapsed' : ''} ${dark ? 'theme-dark' : ''}`}>
    {mobileOpen && <button className="mobile-scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
    <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}><div className="sidebar-brand-row"><Link className="brand" to="/app"><span className="brand-mark"><BarChart3 size={19} /></span><span className="brand-name">insight<span>bi</span></span></Link><button className="icon-button sidebar-collapse" onClick={() => setCollapsed((value) => !value)} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}><ChevronLeft size={16} /></button><button className="icon-button mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={17} /></button></div>
      <div className="workspace-switch"><span className="workspace-avatar">{user?.email?.slice(0, 1).toUpperCase() ?? 'L'}</span><span className="workspace-name"><strong>{user?.email?.split('@')[0] ?? 'Local workspace'}</strong><small>{user ? 'Personal account' : 'This browser only'}</small></span><ChevronDown size={14} /></div>
      <div className="nav-group"><span className="nav-label">WORKSPACE</span>{mainLinks.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} title={label}><Icon size={17} /><span>{label}</span></NavLink>)}</div>
      <div className="nav-group"><span className="nav-label">ANALYSIS</span>{modules.map(({ id, name, icon: Icon }) => <NavLink key={id} to={`/app/modules/${id}`} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} title={name}><Icon size={17} /><span>{name}</span></NavLink>)}<NavLink to="/app/reports" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} title="Reports"><FileBarChart size={17} /><span>Reports</span></NavLink></div>
      <div className="sidebar-bottom"><NavLink to="/app/projects" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} title="Project history"><FolderKanban size={17} /><span>Project history</span></NavLink><div className="sidebar-rule"/><button className="nav-link" onClick={() => setDark((value) => !value)} title={dark ? 'Switch to light theme' : 'Switch to dark theme'}>{dark ? <Sun size={17} /> : <Moon size={17} />}<span>{dark ? 'Light appearance' : 'Dark appearance'}</span></button>{user ? <button className="nav-link" onClick={() => void signOut()} title="Sign out"><LogOut size={17} /><span>Sign out</span></button> : <Link to="/auth" className="nav-link" title="Sign in"><Cloud size={17} /><span>Connect account</span></Link>}</div>
      <div className="sidebar-status"><span className={user ? 'status-cloud' : ''} />{user ? 'Synced metadata' : 'Data stays in this browser'}</div>
    </aside>
    <div className="app-content"><header className="topbar"><button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={19} /></button><div className="breadcrumbs"><span>Workspace</span><span>/</span><strong>{currentLabel}</strong></div><div className="topbar-right"><div className="connection-state"><span />{user ? 'Connected' : 'Local mode'}</div><button className="icon-button topbar-theme" onClick={() => setDark((value) => !value)} title={dark ? 'Switch to light theme' : 'Switch to dark theme'}>{dark ? <Sun size={16} /> : <Moon size={16} />}</button><div className="user-initial">{user?.email?.slice(0, 1).toUpperCase() ?? 'L'}</div></div></header><main className="app-main"><Outlet /></main><footer className="app-footer"><span>InsightBI</span><span>Local data · private by default</span><a href="https://supabase.com/docs" target="_blank" rel="noreferrer">Supabase setup <ArrowRight size={12} /></a></footer></div>
  </div>;
}

function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{actions && <div className="page-actions">{actions}</div>}</div>;
}

function EmptyDataState({ onSample }: { onSample: () => void }) {
  return <section className="empty-state"><div className="empty-icon"><Database size={22} /></div><span className="eyebrow">START WITH A REAL DATASET</span><h2>Bring your first file.</h2><p>InsightBI calculates metrics only from data you upload. Files are stored in this browser, not sent to a server.</p><div className="empty-actions"><Link className="button button-dark" to="/app/datasets"><Upload size={15} />Upload a dataset</Link><button className="button button-secondary" onClick={onSample}><Sparkles size={15} />Explore synthetic sample</button></div><button className="text-action sample-download" onClick={() => downloadText('insightbi-synthetic-retail.csv', exportCsv(makeRetailSample()))}><Download size={14} />Download the synthetic retail CSV</button></section>;
}

function DashboardPage() {
  const { datasets, activeDataset, setActiveDatasetId, addDataset } = useWorkspace();
  const [notice, setNotice] = useState('');
  const [comparisonKind, setComparisonKind] = useState<'products' | 'categories' | 'regions'>('products');
  async function addSample() {
    const sample = makeRetailSample();
    await addDataset(sample);
    setNotice('Synthetic retail data added to this browser workspace.');
  }
  if (!activeDataset) return <><PageHeader eyebrow="YOUR DATA, IN FOCUS" title="Good analysis starts with a good question." description="Upload a dataset to calculate your first business KPIs." />{notice && <div className="inline-notice" role="status">{notice}</div>}<EmptyDataState onSample={() => void addSample()} /></>;
  const dataset = activeDataset;
  const metrics = calculateMetrics(dataset);
  const topItems = metrics[comparisonKind].slice(0, 5);
  const comparisonRole = comparisonKind === 'categories' ? 'category' : comparisonKind === 'regions' ? 'region' : 'product';
  const comparisonField = dataset.mappings[comparisonRole];
  const comparisonLabel = comparisonKind === 'products' ? 'Top products' : comparisonKind === 'categories' ? 'Category comparison' : 'Regional comparison';
  const currencyAvailable = metrics.hasRevenue;
  return <div className="page-stack dashboard-page"><PageHeader eyebrow="YOUR DATA, IN FOCUS" title="Overview" description="A readout of the dataset you selected. Every figure is calculated from its rows." actions={<label className="dataset-select-label"><span>Dataset</span><select value={dataset.id} onChange={(event) => setActiveDatasetId(event.target.value)}>{datasets.map((item) => <option key={item.id} value={item.id}>{item.name}{item.isSynthetic ? ' · Synthetic' : ''}</option>)}</select></label>} />
    {dataset.isSynthetic && <div className="synthetic-banner"><Sparkles size={15} /><span><strong>Synthetic sample</strong> · Illustrative retail orders generated locally. Revenue, cost, and margin are computed from sample rows.</span><button onClick={() => downloadText('insightbi-synthetic-retail.csv', exportCsv(dataset))}><Download size={14} />Download</button></div>}
    <div className="metrics-grid"><MetricCard label={currencyAvailable ? 'Total revenue' : 'Total numeric value'} value={formatCurrency(metrics.revenue)} detail={metrics.hasRevenue ? `From ${dataset.columns.find((column) => column.key === dataset.mappings.revenue)?.name}` : 'No revenue column detected'} icon={<Activity size={17} />} /><MetricCard label={metrics.hasProfit ? 'Total profit' : 'Profit'} value={metrics.hasProfit ? formatCurrency(metrics.profit) : 'Not detected'} detail={metrics.hasProfit ? 'Revenue less cost, or sum of profit' : 'Map revenue and cost columns'} icon={<Gauge size={17} />} /><MetricCard label="Profit margin" value={metrics.hasProfit && metrics.hasRevenue ? `${metrics.margin.toFixed(1)}%` : 'Not available'} detail="Profit ÷ revenue" icon={<BarChart3 size={17} />} /><MetricCard label="Records" value={new Intl.NumberFormat().format(metrics.recordCount)} detail={`${dataset.columns.length} fields · ${getDataQuality(dataset).missing.toLocaleString()} missing cells`} icon={<Table2 size={17} />} /></div>
    <div className="dashboard-grid"><section className="panel chart-panel"><div className="panel-heading"><div><span className="panel-kicker">MONTHLY PERFORMANCE</span><h2>Revenue over time</h2><p>{metrics.months.length ? 'Grouped by the detected date field.' : 'Add a date and revenue column to see a time series.'}</p></div><span className="chart-caption">{dataset.columns.find((column) => column.key === dataset.mappings.date)?.name ?? 'Date field not detected'}</span></div>{metrics.months.length ? <div className="dashboard-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={metrics.months} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}><defs><linearGradient id="revenueArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#526bea" stopOpacity={0.17} /><stop offset="100%" stopColor="#526bea" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="var(--grid-line)" strokeDasharray="2 5" vertical={false} /><XAxis dataKey="month" tickFormatter={(value: string) => value.slice(5)} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" /><YAxis tickFormatter={(value: number) => value >= 1000 ? `$${Math.round(value / 1000)}k` : `$${value}`} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={44} /><Tooltip formatter={(value) => [formatCurrency(Number(value)), 'Revenue']} labelFormatter={(label) => String(label)} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-primary)' }} /><Area dataKey="value" type="monotone" stroke="#526bea" strokeWidth={2.25} fill="url(#revenueArea)" activeDot={{ r: 4, strokeWidth: 0 }} /></AreaChart></ResponsiveContainer></div> : <div className="chart-empty"><Activity size={22} /><span>Monthly figures need a recognizable date column and a numeric revenue or sales field.</span></div>}</section>
      <section className="panel ranking-panel"><div className="panel-heading"><div><span className="panel-kicker">REVENUE COMPARISON</span><h2>{comparisonLabel}</h2><p>{dataset.columns.find((column) => column.key === comparisonField)?.name ?? `Map a ${comparisonRole} field to compare`}</p></div><label className="comparison-select"><span>Compare</span><select value={comparisonKind} onChange={(event) => setComparisonKind(event.target.value as typeof comparisonKind)}><option value="products">Products</option><option value="categories">Categories</option><option value="regions">Regions</option></select></label></div>{topItems.length ? <div className="ranking-list">{topItems.map((item, index) => <div className="ranking-item" key={item.label}><span className="ranking-index">{String(index + 1).padStart(2, '0')}</span><div className="ranking-info"><strong>{item.label}</strong><span className="ranking-track"><i style={{ width: `${Math.max(4, item.value / topItems[0].value * 100)}%` }} /></span></div><strong className="ranking-value">{formatCurrency(item.value)}</strong></div>)}</div> : <div className="chart-empty">Map a revenue field and this comparison field to calculate rankings.</div>}<div className="ranking-foot"><span>Based on {metrics.recordCount.toLocaleString()} records</span><Link to="/app/datasets">Inspect data<ArrowRight size={12} /></Link></div></section></div>
    <section className="dashboard-bottom"><div className="data-source-line"><span className="source-status" /><div><strong>{dataset.name}</strong><span>{dataset.isSynthetic ? 'Synthetic sample' : 'Stored in this browser'} · Updated {new Date(dataset.createdAt).toLocaleDateString()}</span></div><Link className="icon-button" to="/app/datasets" title="Open dataset" aria-label="Open dataset"><ArrowRight size={15} /></Link></div><div className="quick-actions"><Link to="/app/sql"><TerminalIcon size={16} /><span><strong>Ask a question</strong><small>Query this dataset with SQL</small></span><ArrowRight size={14} /></Link><Link to="/app/studio"><BarChart3 size={16} /><span><strong>Build a visualization</strong><small>Compare fields and trends</small></span><ArrowRight size={14} /></Link><Link to="/app/reports"><FileBarChart size={16} /><span><strong>Write a report</strong><small>Save findings and recommendations</small></span><ArrowRight size={14} /></Link></div></section>
  </div>;
}

function MetricCard({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: ReactNode }) {
  return <article className="metric-card"><div className="metric-top"><span>{label}</span><span className="metric-icon">{icon}</span></div><strong>{value}</strong><small>{detail}</small></article>;
}

function DatasetsPage() {
  const { datasets, activeDataset, setActiveDatasetId, addDataset, updateDataset, deleteDataset } = useWorkspace();
  const fileInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [filterKey, setFilterKey] = useState('');
  const [filterValue, setFilterValue] = useState('');
  const [renameKey, setRenameKey] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const quality = activeDataset ? getDataQuality(activeDataset) : null;
  const filteredRows = activeDataset?.rows.filter((row) => {
    const matchesSearch = !search || activeDataset.columns.some((column) => String(row[column.key] ?? '').toLowerCase().includes(search.toLowerCase()));
    const matchesFilter = !filterKey || !filterValue || String(row[filterKey] ?? '').toLowerCase().includes(filterValue.toLowerCase());
    return matchesSearch && matchesFilter;
  }) ?? [];

  async function uploadFile(file?: File) {
    if (!file) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const dataset = await importDataset(file);
      await addDataset(dataset);
      setNotice(`${dataset.name} is ready. ${dataset.rows.length.toLocaleString()} rows and ${dataset.columns.length} columns imported to this browser.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The file could not be imported.'); }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  async function addSample() {
    setBusy(true); setError('');
    try { await addDataset(makeRetailSample()); setNotice('Synthetic retail sample added to the workspace.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Sample data could not be added.'); }
    finally { setBusy(false); }
  }
  async function saveRename(event: FormEvent) {
    event.preventDefault();
    if (!activeDataset || !renameKey) return;
    try { await updateDataset(renameColumn(activeDataset, renameKey, renameValue)); setNotice('Column name updated.'); setRenameKey(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Column name could not be changed.'); }
  }
  async function cleanRows(keepRow: (row: DataRow, index: number) => boolean, label: string) {
    if (!activeDataset) return;
    const rows = activeDataset.rows.filter((row, index) => keepRow(row, index));
    await updateDataset({ ...activeDataset, rows, columns: activeDataset.columns.map((column) => ({ ...column, missing: rows.filter((row) => row[column.key] == null || row[column.key] === '').length })) });
    setNotice(`${activeDataset.rows.length - rows.length} ${label} removed.`);
  }
  function removeDuplicateRows() {
    if (!activeDataset) return;
    const seen = new Set<string>();
    void cleanRows((row) => {
      const signature = JSON.stringify(activeDataset.columns.map((column) => row[column.key]));
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    }, 'duplicate rows');
  }
  function changeMapping(role: keyof Dataset['mappings'], value: string) {
    if (!activeDataset) return;
    void updateDataset({ ...activeDataset, mappings: { ...activeDataset.mappings, [role]: value || undefined } });
  }
  const duplicateCount = quality?.duplicates ?? 0;
  const missingCount = quality?.missing ?? 0;

  return <div className="page-stack"><PageHeader eyebrow="DATA MANAGEMENT" title="Datasets" description="Import, inspect, clean, and export the rows behind your analysis." actions={<><input ref={fileInput} className="visually-hidden" type="file" accept=".csv,.xlsx,.xls" onChange={(event) => void uploadFile(event.target.files?.[0])} /><button className="button button-secondary" onClick={() => downloadText('insightbi-synthetic-retail.csv', exportCsv(makeRetailSample()))}><Download size={15} />Sample CSV</button><button className="button button-dark" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={15} />{busy ? 'Importing…' : 'Upload file'}</button></>} />
    {error && <div className="inline-error" role="alert">{error}</div>}{notice && <div className="inline-notice" role="status"><Check size={15} />{notice}<button onClick={() => setNotice('')} aria-label="Dismiss">×</button></div>}
    {!datasets.length ? <EmptyDataState onSample={() => void addSample()} /> : activeDataset && <>
      <section className="dataset-overview panel"><div className="dataset-overview-main"><label className="field-label">Active dataset<select value={activeDataset.id} onChange={(event) => setActiveDatasetId(event.target.value)}>{datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}{dataset.isSynthetic ? ' · Synthetic' : ''}</option>)}</select></label><div className="dataset-meta"><span><Table2 size={14} />{activeDataset.rows.length.toLocaleString()} rows</span><span><Database size={14} />{activeDataset.columns.length} columns</span><span><Cloud size={14} />Local browser storage</span>{activeDataset.isSynthetic && <span className="synthetic-tag"><span />Synthetic sample</span>}</div></div><div className="quality-summary"><div><small>Missing cells</small><strong className={missingCount ? 'quality-warn' : ''}>{missingCount.toLocaleString()}</strong></div><div><small>Duplicate rows</small><strong className={duplicateCount ? 'quality-warn' : ''}>{duplicateCount.toLocaleString()}</strong></div><div><small>Unique rows</small><strong>{(activeDataset.rows.length - duplicateCount).toLocaleString()}</strong></div></div></section>
      <div className="dataset-workspace"><section className="panel data-table-panel"><div className="table-toolbar"><div className="table-title"><div><span className="panel-kicker">DATA PREVIEW</span><h2>{activeDataset.name}</h2></div><span className="rows-count">{filteredRows.length.toLocaleString()} visible rows</span></div><div className="table-controls"><label className="search-control"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search all columns" aria-label="Search all columns" /></label><label className="filter-control"><Filter size={14} /><select value={filterKey} onChange={(event) => setFilterKey(event.target.value)} aria-label="Filter column"><option value="">Filter column</option>{activeDataset.columns.map((column) => <option key={column.key} value={column.key}>{column.name}</option>)}</select><input value={filterValue} onChange={(event) => setFilterValue(event.target.value)} disabled={!filterKey} placeholder="Contains…" aria-label="Filter value" /></label></div></div>
        <div className="table-scroll"><table className="data-table"><thead><tr>{activeDataset.columns.map((column) => <th key={column.key}><span>{column.name}</span><small>{column.type}</small></th>)}</tr></thead><tbody>{filteredRows.slice(0, 100).map((row, index) => <tr key={index}>{activeDataset.columns.map((column) => <td key={column.key} title={String(row[column.key] ?? 'Missing')}>{row[column.key] == null ? <span className="missing-value">—</span> : String(row[column.key])}</td>)}</tr>)}</tbody></table>{filteredRows.length > 100 && <div className="table-limit">Showing the first 100 matches. Export to review the full filtered dataset.</div>}{!filteredRows.length && <div className="table-no-results">No rows match these filters.</div>}</div><div className="table-foot"><span>Preview shows up to 100 rows · Imported data stays in IndexedDB on this device.</span><button className="subtle-link" onClick={() => downloadText(`${activeDataset.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-cleaned.csv`, exportCsv(activeDataset, filteredRows))}><Download size={14} />Export filtered CSV</button></div></section>
      <aside className="dataset-side"><section className="panel schema-panel"><div className="panel-heading"><div><span className="panel-kicker">FIELD PROFILE</span><h2>Schema</h2></div><span className="schema-count">{activeDataset.columns.length}</span></div><div className="schema-list">{activeDataset.columns.map((column) => <div className="schema-row" key={column.key}><div className="schema-name"><strong>{column.name}</strong><span>{column.type} · {column.missing.toLocaleString()} missing</span></div><button className="icon-button schema-edit" onClick={() => { setRenameKey(column.key); setRenameValue(column.name); }} title={`Rename ${column.name}`} aria-label={`Rename ${column.name}`}><Settings2 size={14} /></button></div>)}</div>{renameKey && <form className="rename-form" onSubmit={(event) => void saveRename(event)}><label className="field-label">Rename field<input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} maxLength={80} autoFocus /></label><div><button className="button button-dark button-small" type="submit">Save name</button><button className="button button-quiet button-small" type="button" onClick={() => setRenameKey('')}>Cancel</button></div></form>}</section>
        <section className="panel mapping-panel"><div className="panel-heading"><div><span className="panel-kicker">COLUMN MAPPING</span><h2>Business fields</h2></div></div>{([['revenue', 'Revenue'], ['cost', 'Cost'], ['profit', 'Profit'], ['category', 'Category'], ['date', 'Date'], ['region', 'Region'], ['product', 'Product']] as const).map(([role, label]) => <label className="field-label" key={role}>{label}<select value={activeDataset.mappings[role] ?? ''} onChange={(event) => changeMapping(role, event.target.value)}><option value="">Not mapped</option>{activeDataset.columns.map((column) => <option value={column.key} key={column.key}>{column.name} · {column.type}</option>)}</select></label>)}</section>
        <section className="panel clean-panel"><div className="panel-heading"><div><span className="panel-kicker">DATA QUALITY</span><h2>Clean this dataset</h2></div><span title="Cleaning changes are saved in this browser workspace."><CircleHelp size={15} /></span></div><button className="clean-action" disabled={!duplicateCount} onClick={removeDuplicateRows}><span><strong>Remove duplicate rows</strong><small>{duplicateCount.toLocaleString()} detected</small></span><Trash2 size={15} /></button><button className="clean-action" disabled={!missingCount} onClick={() => void cleanRows((row) => activeDataset.columns.every((column) => row[column.key] != null && row[column.key] !== ''), 'incomplete rows')}><span><strong>Drop incomplete rows</strong><small>{missingCount.toLocaleString()} missing cells</small></span><Trash2 size={15} /></button><button className="clean-action clean-export" onClick={() => downloadText(`${activeDataset.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-cleaned.csv`, exportCsv(activeDataset))}><span><strong>Download cleaned data</strong><small>CSV · current column names</small></span><Download size={15} /></button></section>
        <button className="delete-dataset" onClick={() => { if (window.confirm(`Remove ${activeDataset.name} from this browser?`)) void deleteDataset(activeDataset.id); }}><Trash2 size={14} />Remove dataset from this browser</button></aside></div>
    </>}
    </div>;
}

function highlightSql(sql: string) {
  const parts = sql.split(/(--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|\b(?:SELECT|FROM|WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AS|AND|OR|NOT|NULL|IS|IN|LIKE|BETWEEN|WITH|RECURSIVE|UNION|ALL|DISTINCT|CASE|WHEN|THEN|ELSE|END|ASC|DESC|COUNT|SUM|AVG|MIN|MAX|CAST|INTEGER|REAL|TEXT)\b)/gi);
  return parts.map((part, index) => {
    let kind = '';
    if (/^--|^\/\*/.test(part)) kind = 'sql-comment';
    else if (/^'/.test(part)) kind = 'sql-string';
    else if (/^(SELECT|FROM|WHERE|GROUP|ORDER|HAVING|LIMIT|OFFSET|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AS|AND|OR|NOT|NULL|IS|IN|LIKE|BETWEEN|WITH|RECURSIVE|UNION|ALL|DISTINCT|CASE|WHEN|THEN|ELSE|END|ASC|DESC)$/i.test(part)) kind = 'sql-keyword';
    else if (/^(COUNT|SUM|AVG|MIN|MAX|CAST)$/i.test(part)) kind = 'sql-function';
    return kind ? <span className={kind} key={index}>{part}</span> : <span key={index}>{part}</span>;
  });
}

function SqlPage() {
  const { datasets, activeDataset, setActiveDatasetId, addDataset } = useWorkspace();
  const [sql, setSql] = useState('');
  const [result, setResult] = useState<{ columns: string[]; rows: Array<Record<string, string | number | null>>; truncated: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editorScroll, setEditorScroll] = useState({ top: 0, left: 0 });
  useEffect(() => {
    if (activeDataset) setSql(`SELECT *\nFROM "${activeDataset.tableName}"\nLIMIT 25;`);
    setResult(null); setError('');
  }, [activeDataset?.id]);
  async function execute() {
    if (!activeDataset || !sql.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const queryResult = await runWorkspaceSql(sql, datasets);
      setResult(queryResult);
      setNotice(`${queryResult.rows.length.toLocaleString()} rows returned${queryResult.truncated ? ' · display limited to 1,000 rows' : ''}.`);
    } catch (reason) { setResult(null); setError(reason instanceof Error ? reason.message : 'Query could not be completed.'); }
    finally { setBusy(false); }
  }
  if (!datasets.length) return <div className="page-stack"><PageHeader eyebrow="ISOLATED QUERY WORKSPACE" title="SQL laboratory" description="Explore uploaded datasets with read-only SQL in an isolated browser engine." /><EmptyDataState onSample={() => void addDataset(makeRetailSample())} /></div>;
  return <div className="page-stack sql-page"><PageHeader eyebrow="ISOLATED QUERY WORKSPACE" title="SQL laboratory" description="Read-only SQL over datasets in this browser. Queries never run against your production database." actions={<label className="dataset-select-label"><span>Dataset</span><select value={activeDataset?.id ?? ''} onChange={(event) => setActiveDatasetId(event.target.value)}>{datasets.map((dataset) => <option value={dataset.id} key={dataset.id}>{dataset.name}</option>)}</select></label>} />
    <div className="sql-workspace"><section className="panel sql-editor-panel"><div className="sql-toolbar"><div className="sql-tabs"><span className="sql-tab-dot" /><span>query.sql</span><span className="sql-unsaved">unsaved</span></div><div className="sql-toolbar-actions"><span className="read-only-label"><ShieldCheck size={13} />READ ONLY</span><button className="button button-dark button-small" onClick={() => void execute()} disabled={busy || !activeDataset}>{busy ? <span className="button-spinner" /> : <Sparkles size={14} />}{busy ? 'Running…' : 'Run query'}</button></div></div><div className="sql-editor-wrap"><pre className="sql-highlight" aria-hidden="true" style={{ transform: `translate(${-editorScroll.left}px, ${-editorScroll.top}px)` }}><code>{highlightSql(sql || ' ')}</code></pre><textarea className="sql-input" value={sql} onChange={(event) => setSql(event.target.value)} onScroll={(event) => setEditorScroll({ top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft })} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void execute(); } }} spellCheck={false} aria-label="SQL query editor" aria-describedby="sql-help" placeholder="SELECT * FROM dataset_name LIMIT 25;" />{!sql && <span className="sql-placeholder">Write a query against any dataset table…</span>}</div><div className="sql-editor-foot"><span id="sql-help">Ctrl/⌘ + Enter to run · SELECT and CTE queries only</span><span>{sql.length.toLocaleString()} / 10,000</span></div>{error && <div className="inline-error sql-message" role="alert">{error}</div>}{notice && <div className="inline-notice sql-message" role="status">{notice}</div>}</section>
      <aside className="panel schema-panel sql-schema"><div className="panel-heading"><div><span className="panel-kicker">AVAILABLE TABLES</span><h2>Workspace schema</h2></div><Database size={16} /></div>{datasets.map((dataset) => <div className="sql-table-schema" key={dataset.id}><div className="sql-table-name"><Table2 size={14} /><code>{dataset.tableName}</code></div>{dataset.columns.map((column) => <div className="sql-field" key={column.key}><span>{column.name}</span><code>{column.key}</code><small>{column.type}</small></div>)}</div>)}<p className="sql-security-note"><ShieldCheck size={14} />SQL.js runs in a disposable worker. Writes, schema changes, and multi-statement queries are blocked.</p></aside></div>
    <section className="panel results-panel"><div className="results-heading"><div><span className="panel-kicker">QUERY RESULTS</span><h2>{result ? `${result.rows.length.toLocaleString()} rows` : 'Results will appear here'}</h2></div><span className="results-state"><span className={result ? 'result-dot' : ''} />{result ? 'Completed in your browser' : 'Waiting for query'}</span></div>{result ? result.rows.length ? <div className="table-scroll result-table-scroll"><table className="data-table result-table"><thead><tr>{result.columns.map((column) => <th key={column}>{column}<small>result</small></th>)}</tr></thead><tbody>{result.rows.slice(0, 100).map((row, index) => <tr key={index}>{result.columns.map((column) => <td key={column}>{row[column] == null ? <span className="missing-value">NULL</span> : String(row[column])}</td>)}</tr>)}</tbody></table>{result.rows.length > 100 && <div className="table-limit">Preview shows the first 100 rows. All {result.rows.length.toLocaleString()} rows are available for this query.</div>}{result.truncated && <div className="table-limit">Result display capped at 1,000 rows. Add a LIMIT clause for a narrower result.</div>}</div> : <div className="results-empty">The query completed without matching rows.</div> : <div className="results-empty"><TerminalIcon size={20} />Run a SELECT query to inspect your dataset.</div>}</section>
  </div>;
}

function ModulePage() {
  const { moduleId = 'sales' } = useParams();
  const { datasets, activeDataset, setActiveDatasetId, addDataset } = useWorkspace();
  const module = modules.find((item) => item.id === moduleId) ?? modules[0];
  const [groupKey, setGroupKey] = useState('');
  const [measureKey, setMeasureKey] = useState('');
  const [chartKind, setChartKind] = useState<'bar' | 'line' | 'pie'>('bar');
  const dataset = activeDataset;
  useEffect(() => {
    if (!dataset) return;
    const textFields = dataset.columns.filter((column) => column.type !== 'number');
    const numericFields = dataset.columns.filter((column) => column.type === 'number');
    setGroupKey(dataset.mappings.category ?? dataset.mappings.region ?? textFields[0]?.key ?? '');
    setMeasureKey(dataset.mappings.revenue ?? dataset.mappings.profit ?? numericFields[0]?.key ?? '');
  }, [dataset?.id]);
  if (!dataset) return <div className="page-stack"><PageHeader eyebrow="BUSINESS ANALYSIS" title={module.name} description="A focused workspace for questions grounded in your data." /><EmptyDataState onSample={() => void addDataset(makeRetailSample())} /></div>;
  const textFields = dataset.columns.filter((column) => column.type !== 'number');
  const numericFields = dataset.columns.filter((column) => column.type === 'number');
  const selectedField = dataset.columns.find((column) => column.key === measureKey);
  const values = new Map<string, number>();
  for (const row of dataset.rows) {
    const label = String(row[groupKey] ?? '(blank)');
    values.set(label, (values.get(label) ?? 0) + (typeof row[measureKey] === 'number' ? row[measureKey] as number : 0));
  }
  const groups = [...values.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 12);
  const total = dataset.rows.reduce((sum, row) => sum + (typeof row[measureKey] === 'number' ? row[measureKey] as number : 0), 0);
  const average = dataset.rows.length ? total / dataset.rows.length : 0;
  const quality = getDataQuality(dataset);
  const leader = groups[0];
  const share = total ? Math.max(0, leader?.value ?? 0) / Math.abs(total) * 100 : 0;
  const questions = moduleId === 'customers'
    ? ['Which customer or segment contributes the most to the selected measure?', 'How concentrated is value across the largest groups?', 'Which groups have the most incomplete records?']
    : moduleId === 'hr'
      ? ['How does the selected measure vary across departments or regions?', 'Which groups show the largest differences?', 'Are missing records concentrated in a particular group?']
      : moduleId === 'students'
        ? ['Which course or cohort has the highest average selected score?', 'How much does performance vary across groups?', 'How complete are the records for this measure?']
        : moduleId === 'budget'
          ? ['Which category accounts for the largest share of the selected amount?', 'How does the total vary by region or month?', 'Where are incomplete expense records concentrated?']
          : moduleId === 'ecommerce'
            ? ['Which product or category contributes the most to the selected amount?', 'How does performance change across regions?', 'Which groups have the most incomplete order data?']
            : ['Which category or region drives the selected measure?', 'How concentrated is the total among top-performing groups?', 'How much profit is retained per revenue dollar?'];
  const recommendations = [
    leader && total ? `${leader.label} contributes ${share.toFixed(1)}% of the selected total. Validate whether this concentration matches your target mix.` : 'Choose a numeric measure with non-zero values to calculate group contribution.',
    quality.missing ? `${quality.missing.toLocaleString()} cells are missing. Review their fields before drawing conclusions from comparisons.` : 'No missing cells were detected in this dataset.',
    dataset.mappings.revenue && dataset.mappings.cost && calculateMetrics(dataset).margin < 0 ? 'Computed costs exceed revenue. Review pricing and cost assumptions in the source data.' : 'Compare the strongest and weakest groups before changing allocation or operating assumptions.',
  ];
  const Icon = module.icon;
  return <div className="page-stack module-page"><PageHeader eyebrow="BUSINESS ANALYSIS WORKSPACE" title={module.name} description="Questions, comparisons, and recommendations computed from the selected dataset." actions={<label className="dataset-select-label"><span>Dataset</span><select value={dataset.id} onChange={(event) => setActiveDatasetId(event.target.value)}>{datasets.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>} />
    {dataset.isSynthetic && <div className="synthetic-banner"><Sparkles size={15} /><span><strong>Synthetic sample</strong> · Module results are calculated from generated sample records.</span></div>}
    <div className="module-intro panel"><span className="module-icon"><Icon size={20} /></span><div><span className="panel-kicker">ANALYSIS LENS</span><h2>{module.name}</h2><p>{dataset.rows.length.toLocaleString()} records · {dataset.columns.length} fields · selecting fields recalculates the analysis</p></div><div className="module-controls"><label className="field-label">Group by<select value={groupKey} onChange={(event) => setGroupKey(event.target.value)}>{textFields.map((field) => <option key={field.key} value={field.key}>{field.name}</option>)}</select></label><label className="field-label">Measure<select value={measureKey} onChange={(event) => setMeasureKey(event.target.value)}>{numericFields.map((field) => <option key={field.key} value={field.key}>{field.name}</option>)}</select></label></div></div>
    <div className="metrics-grid module-metrics"><MetricCard label="Records analyzed" value={dataset.rows.length.toLocaleString()} detail="Rows in selected dataset" icon={<Table2 size={17} />} /><MetricCard label={`Total ${selectedField?.name ?? 'measure'}`} value={new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(total)} detail="Sum of non-missing numeric values" icon={<Activity size={17} />} /><MetricCard label="Average per record" value={new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(average)} detail={selectedField?.name ?? 'Selected measure'} icon={<Gauge size={17} />} /><MetricCard label="Top group share" value={total ? `${share.toFixed(1)}%` : 'Not available'} detail={leader?.label ?? 'No groups with values'} icon={<BarChart3 size={17} />} /></div>
    <div className="module-analysis-grid"><section className="panel chart-panel"><div className="panel-heading"><div><span className="panel-kicker">COMPARISON</span><h2>{selectedField?.name ?? 'Selected measure'} by {dataset.columns.find((column) => column.key === groupKey)?.name ?? 'group'}</h2><p>Aggregated directly from {dataset.rows.length.toLocaleString()} source rows.</p></div><div className="chart-kind-tabs">{(['bar', 'line', 'pie'] as const).map((kind) => <button className={chartKind === kind ? 'selected' : ''} onClick={() => setChartKind(kind)} key={kind}>{kind}</button>)}</div></div><div className="module-chart">{groups.length ? <ResponsiveContainer width="100%" height="100%">{chartKind === 'pie' ? <PieChart><Pie data={groups} dataKey="value" nameKey="label" outerRadius="72%" innerRadius="45%" paddingAngle={2}>{groups.map((item, index) => <Cell key={item.label} fill={['#536de8', '#64a593', '#dc8c6b', '#d2ab5d', '#6593a3', '#a67db1'][index % 6]} />)}</Pie><Tooltip formatter={(value) => [new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(Number(value)), selectedField?.name ?? 'Value']} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4 }} /></PieChart> : chartKind === 'line' ? <LineChart data={groups}><CartesianGrid stroke="var(--grid-line)" strokeDasharray="2 5" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4 }} /><Line dataKey="value" stroke="#536de8" strokeWidth={2} dot={{ r: 3 }} /></LineChart> : <BarChart data={groups}><CartesianGrid stroke="var(--grid-line)" strokeDasharray="2 5" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} interval={0} angle={groups.length > 6 ? -20 : 0} textAnchor={groups.length > 6 ? 'end' : 'middle'} height={groups.length > 6 ? 55 : 30} /><YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4 }} /><Bar dataKey="value" fill="#536de8" radius={[3, 3, 0, 0]} /></BarChart>}</ResponsiveContainer> : <div className="chart-empty">Choose a text field and a numeric measure to compare groups.</div>}</div></section>
      <section className="panel analysis-copy-panel"><span className="panel-kicker">QUESTIONS TO INVESTIGATE</span><h2>Start with the evidence.</h2><ol className="question-list">{questions.map((question) => <li key={question}>{question}</li>)}</ol><div className="analysis-divider" /><span className="panel-kicker">COMPUTED OBSERVATIONS</span><ul className="recommendation-list">{recommendations.map((recommendation) => <li key={recommendation}><Check size={14} />{recommendation}</li>)}</ul><p className="analysis-limitation">Recommendations use detected column names and observed values. Validate assumptions with domain context.</p></section></div>
  </div>;
}

function makeReportContent(dataset: Dataset) {
  const metrics = calculateMetrics(dataset);
  const quality = getDataQuality(dataset);
  const leader = metrics.groups[0];
  const findings = [
    `${dataset.rows.length.toLocaleString()} records and ${dataset.columns.length} columns were analyzed.`,
    metrics.hasRevenue ? `Total ${dataset.columns.find((column) => column.key === dataset.mappings.revenue)?.name ?? 'revenue'}: ${formatCurrency(metrics.revenue)}.` : 'No recognizable revenue or sales field was detected; revenue KPIs are unavailable.',
    metrics.hasProfit && metrics.hasRevenue ? `Calculated profit is ${formatCurrency(metrics.profit)} and margin is ${metrics.margin.toFixed(1)}%.` : 'Profit could not be calculated from the detected columns.',
    leader ? `${leader.label} is the top group by ${dataset.columns.find((column) => column.key === (dataset.mappings.category ?? dataset.mappings.product ?? dataset.mappings.region))?.name ?? 'category'}, with ${formatCurrency(leader.value)} in recorded revenue.` : 'No category-level revenue comparison was available.',
    quality.missing ? `${quality.missing.toLocaleString()} cells are missing across the dataset.` : 'No missing cells were detected.',
  ];
  const recommendations = [
    leader ? `Review the leading group, ${leader.label}, alongside lower-ranked groups before making allocation decisions.` : 'Add a category, product, or region field to compare business segments.',
    quality.missing ? `Inspect the ${quality.missing.toLocaleString()} missing cells and decide whether to correct, exclude, or retain them.` : 'Retain the complete-row check as a baseline for future uploads.',
    metrics.hasProfit && metrics.margin < 0 ? 'Investigate the negative calculated margin and validate the source revenue and cost definitions.' : metrics.hasProfit ? 'Monitor the calculated margin over time to distinguish sustained change from a single-period fluctuation.' : 'Add recognizable revenue and cost columns to calculate profit and margin.',
  ];
  return { metrics, quality, findings, recommendations };
}

function ReportsPage() {
  const { datasets, activeDataset, setActiveDatasetId, reports, addReport, addDataset } = useWorkspace();
  const [title, setTitle] = useState('Business analysis report');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  if (!activeDataset) return <div className="page-stack"><PageHeader eyebrow="ANALYSIS OUTPUT" title="Reports" description="Generate a report from measured results, findings, and limitations." /><EmptyDataState onSample={() => void addDataset(makeRetailSample())} /></div>;
  const dataset = activeDataset;
  const report = makeReportContent(dataset);
  const contentRows = [
    ['Section', 'Finding'],
    ['Dataset', `${dataset.name} (${dataset.rows.length} rows, ${dataset.columns.length} columns)`],
    ['Methodology', 'Calculated from the selected local dataset; revenue uses the detected revenue/sales field; profit is revenue less cost or the sum of a detected profit field; margin is profit divided by revenue.'],
    ['Total revenue', report.metrics.hasRevenue ? report.metrics.revenue.toFixed(2) : 'Not detected'],
    ['Total profit', report.metrics.hasProfit ? report.metrics.profit.toFixed(2) : 'Not detected'],
    ['Profit margin', report.metrics.hasProfit && report.metrics.hasRevenue ? `${report.metrics.margin.toFixed(2)}%` : 'Not available'],
    ...report.metrics.groups.slice(0, 8).map((group) => [`Chart · Revenue by group`, `${group.label}: ${group.value.toFixed(2)}`]),
    ...report.findings.map((finding, index) => [`Finding ${index + 1}`, finding]),
    ...report.recommendations.map((recommendation, index) => [`Recommendation ${index + 1}`, recommendation]),
    ['Limitations', `${report.quality.missing} missing cells; inferred mappings: ${Object.entries(dataset.mappings).filter(([, key]) => key).map(([name]) => name).join(', ') || 'none'}. Validate formulas and context before relying on conclusions.`],
  ];
  async function saveCurrentReport() {
    setError(''); setNotice('');
    try {
      await addReport({ id: crypto.randomUUID(), title: title.trim() || 'Business analysis report', datasetId: dataset.id, createdAt: new Date().toISOString() });
      setNotice('Report metadata saved to this workspace.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Report metadata could not be saved.'); }
  }
  return <div className="page-stack reports-page"><PageHeader eyebrow="ANALYSIS OUTPUT" title="Reports" description="A transparent readout of measured results, methodology, assumptions, and next steps." actions={<><button className="button button-secondary" onClick={() => downloadText('insightbi-analysis-report.csv', Papa.unparse(contentRows))}><Download size={15} />Export CSV</button><button className="button button-secondary" onClick={() => window.print()}><FileBarChart size={15} />Print / Save PDF</button><button className="button button-dark" onClick={() => void saveCurrentReport()}><Check size={15} />Save report</button></>} />
    {error && <div className="inline-error" role="alert">{error}</div>}{notice && <div className="inline-notice" role="status">{notice}</div>}
    <div className="report-controls panel"><label className="field-label">Report title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} /></label><label className="field-label">Dataset<select value={dataset.id} onChange={(event) => setActiveDatasetId(event.target.value)}>{datasets.map((item) => <option value={item.id} key={item.id}>{item.name}{item.isSynthetic ? ' · Synthetic' : ''}</option>)}</select></label><div className="report-date"><span>Generated</span><strong>{new Date().toLocaleString()}</strong></div></div>
    <article className="report-document"><header className="report-cover"><div><span className="eyebrow">INSIGHTBI · BUSINESS ANALYSIS</span><h2>{title || 'Business analysis report'}</h2><p>{dataset.name} · {new Date().toLocaleDateString()}</p></div><div className="report-mark"><BarChart3 size={24} /></div></header>
      {dataset.isSynthetic && <div className="synthetic-banner"><Sparkles size={14} /><span><strong>Synthetic sample</strong> · All figures below are calculated from generated sample records.</span></div>}
      <section className="report-section"><div className="report-section-heading"><span>01</span><div><h3>Dataset overview</h3><p>Source and scope of this analysis.</p></div></div><div className="report-overview-grid"><div><small>Dataset</small><strong>{dataset.name}</strong></div><div><small>Records</small><strong>{dataset.rows.length.toLocaleString()}</strong></div><div><small>Fields</small><strong>{dataset.columns.length}</strong></div><div><small>Missing cells</small><strong>{report.quality.missing.toLocaleString()}</strong></div><div><small>Duplicate rows</small><strong>{report.quality.duplicates.toLocaleString()}</strong></div></div></section>
      <section className="report-section"><div className="report-section-heading"><span>02</span><div><h3>Methodology & KPIs</h3><p>Definitions use the columns detected in this dataset.</p></div></div><div className="report-kpis"><div><small>Total revenue</small><strong>{report.metrics.hasRevenue ? formatCurrency(report.metrics.revenue) : 'Not detected'}</strong></div><div><small>Total profit</small><strong>{report.metrics.hasProfit ? formatCurrency(report.metrics.profit) : 'Not detected'}</strong></div><div><small>Profit margin</small><strong>{report.metrics.hasProfit && report.metrics.hasRevenue ? `${report.metrics.margin.toFixed(1)}%` : 'Not available'}</strong></div></div><p className="report-method">Revenue is the sum of the detected revenue or sales column. Profit is revenue less detected cost, or the sum of a detected profit column when cost is unavailable. Margin is profit divided by revenue. Values are not inferred when required columns are absent.</p></section>
      <section className="report-section"><div className="report-section-heading"><span>03</span><div><h3>Group comparison</h3><p>Top groups by detected revenue.</p></div></div><div className="report-chart">{report.metrics.groups.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={report.metrics.groups.slice(0, 8)} margin={{ top: 5, right: 4, bottom: 0, left: 0 }}><CartesianGrid stroke="var(--grid-line)" strokeDasharray="2 5" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} interval={0} /><YAxis tickFormatter={(value: number) => value >= 1000 ? `$${Math.round(value / 1000)}k` : `$${value}`} tick={{ fontSize: 9, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={43} /><Tooltip formatter={(value) => [formatCurrency(Number(value)), 'Revenue']} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4 }} /><Bar dataKey="value" fill="#536de8" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer> : <div className="chart-empty">A detected category and revenue field are needed for this comparison.</div>}</div></section>
      <section className="report-section"><div className="report-section-heading"><span>04</span><div><h3>Findings</h3><p>Observed directly in the selected dataset.</p></div></div><ol className="report-findings">{report.findings.map((finding) => <li key={finding}>{finding}</li>)}</ol></section>
      <section className="report-section"><div className="report-section-heading"><span>05</span><div><h3>Recommendations</h3><p>Suggested next steps based on the computed findings.</p></div></div><ul className="report-recommendations">{report.recommendations.map((recommendation) => <li key={recommendation}><Check size={15} />{recommendation}</li>)}</ul></section>
      <section className="report-section report-limitations"><div className="report-section-heading"><span>06</span><div><h3>Limitations</h3><p>Important context before sharing results.</p></div></div><p>Column mappings are inferred from field names and values. {report.quality.missing.toLocaleString()} missing cells and {report.quality.duplicates.toLocaleString()} duplicate rows were detected. No causal inference or external data validation is performed. Confirm source definitions, currency, time zone, and business context before decisions.</p></section>
      <footer className="report-footer"><span>InsightBI · Analysis grounded in {dataset.rows.length.toLocaleString()} rows</span><span>{dataset.isSynthetic ? 'Synthetic demonstration data' : 'Data processed in this browser'}</span></footer>
    </article>
    <section className="saved-report-list"><div className="list-heading"><div><span className="panel-kicker">REPORT HISTORY</span><h2>Saved reports</h2></div><span>{reports.length}</span></div>{reports.length ? reports.map((item) => <div className="saved-report-row" key={item.id}><FileBarChart size={16} /><div><strong>{item.title}</strong><span>{datasets.find((source) => source.id === item.datasetId)?.name ?? 'Dataset unavailable'} · {new Date(item.createdAt).toLocaleString()}</span></div></div>) : <p>No reports saved to this workspace yet.</p>}</section>
  </div>;
}

function ProjectsPage() {
  const { datasets, activeDataset, projects, addProject, removeProjectById, setActiveDatasetId } = useWorkspace();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [datasetId, setDatasetId] = useState(activeDataset?.id ?? '');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function createProject(event: FormEvent) {
    event.preventDefault(); setError(''); setNotice('');
    if (!name.trim()) return setError('Enter a project name.');
    try {
      await addProject(name.trim(), datasetId || undefined);
      setNotice(`Project “${name.trim()}” saved to your workspace.`);
      setName('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Project could not be saved.'); }
  }
  return <div className="page-stack"><PageHeader eyebrow="WORKSPACE ORGANIZATION" title="Project history" description="Keep dataset work grouped and reopen a project in one click." />
    {error && <div className="inline-error" role="alert">{error}</div>}{notice && <div className="inline-notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss">×</button></div>}
    <form className="new-project-form panel" onSubmit={(event) => void createProject(event)}><div className="new-project-icon"><Plus size={19} /></div><div className="new-project-fields"><div><span className="panel-kicker">NEW PROJECT</span><h2>Start a new analysis</h2></div><div className="new-project-inputs"><label className="field-label">Project name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="e.g. Q3 sales review" required /></label><label className="field-label">Dataset<select value={datasetId} onChange={(event) => setDatasetId(event.target.value)}><option value="">No dataset yet</option>{datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</select></label><button className="button button-dark" type="submit"><Plus size={15} />Create project</button></div></div></form>
    <div className="project-list-heading"><div><span className="panel-kicker">SAVED PROJECTS</span><h2>Your work</h2></div><span>{projects.length} projects</span></div>
    {projects.length ? <div className="project-grid">{projects.map((project) => {
      const source = datasets.find((dataset) => dataset.id === project.datasetId);
      return <article className="project-card" key={project.id}><div className="project-card-top"><span className="project-icon"><FolderKanban size={18} /></span><button className="icon-button" onClick={() => { if (window.confirm(`Delete “${project.name}”?`)) void removeProjectById(project.id); }} title="Delete project" aria-label={`Delete ${project.name}`}><MoreHorizontal size={17} /></button></div><h3>{project.name}</h3><p>{source?.name ?? 'No dataset linked'}{source?.isSynthetic ? ' · Synthetic' : ''}</p><div className="project-card-foot"><span>{new Date(project.createdAt).toLocaleDateString()}</span><button className="subtle-link" onClick={() => { if (source) setActiveDatasetId(source.id); navigate(source ? '/app' : '/app/datasets'); }}>Open project<ArrowRight size={13} /></button></div></article>;
    })}</div> : <div className="empty-list"><FolderKanban size={20} /><span>No projects yet. Give your next analysis a name above.</span></div>}
    <div className="project-storage-note"><Cloud size={15} /><span>{cloudAuthEnabled ? 'Project metadata syncs to your Supabase account when configured. Dataset rows remain in this browser.' : 'Projects and metadata are saved in this browser. Sign in with Supabase to sync project metadata across devices.'}</span></div>
  </div>;
}

function TerminalIcon({ size = 17 }: { size?: number }) { return <span className="terminal-icon" style={{ width: size, height: size }}>›_</span>; }

export default App;