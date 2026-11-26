import { useEffect, useState } from 'react';
import { BaruchLogo } from './components/BaruchLogo';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import {
  INITIAL_EXPENSES,
  INITIAL_NOTIFICATIONS,
  INITIAL_ORDERS,
} from './data/mockData';
import { getNavMeta } from './navigation';
import { loadClients, subscribeClients } from './clients/clientStore';
import { loadSales, productionOrdersFromSales, subscribeSales, toSaleRecord } from './sales/salesStore';
import type { ClientProfile } from './clients/clientTypes';
import { ChatProjectsPage } from './pages/ChatProjectsPage';
import { ClientsPage } from './pages/ClientsPage';
import { DashboardPage } from './pages/DashboardPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { FilesPage } from './pages/FilesPage';
import { ProductionPage } from './pages/ProductionPage';
import { ProductsPage } from './pages/ProductsPage';
import { ReportsPage } from './pages/ReportsPage';
import { SalesPage } from './pages/SalesPage';
import { SettingsPage } from './pages/SettingsPage';
import type {
  ClientRecord,
  ExpenseRecord,
  NavPageId,
  NotificationItem,
  ProductionFocus,
  ProductionOrder,
  ProductionStatus,
  SaleRecord,
} from './types';

const CURRENT_USER = {
  name: 'Gustavo Castro',
  role: 'Diretor · BARUCH',
  initials: 'GC',
};

export function BaruchApp() {
  const [activePage, setActivePage] = useState<NavPageId>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [breadcrumb, setBreadcrumb] = useState<string | null>(null);
  const [globalSearch, setGlobalSearch] = useState('');
  const [signedOut, setSignedOut] = useState(false);

  const [orders, setOrders] = useState<ProductionOrder[]>(INITIAL_ORDERS);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>(INITIAL_EXPENSES);
  const [notifications, setNotifications] =
    useState<NotificationItem[]>(INITIAL_NOTIFICATIONS);
  const [productionFocus, setProductionFocus] = useState<ProductionFocus | null>(null);
  const [clientDirectory, setClientDirectory] = useState<ClientProfile[]>([]);
  const [chatRequest, setChatRequest] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      loadClients()
        .then((items) => {
          if (alive) setClientDirectory(items);
        })
        .catch(() => undefined);
    };
    refresh();
    const unsubscribe = subscribeClients(refresh);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      loadSales()
        .then((items) => {
          if (!alive) return;
          setSales(items.map(toSaleRecord));
          const generated = productionOrdersFromSales(items);
          setOrders((current) => {
            const ids = new Set(current.map((order) => order.id));
            const fresh = generated.filter((order) => !ids.has(order.id));
            const cancelled = new Set(
              items.filter((sale) => sale.status === 'cancelada').flatMap((sale) => sale.productionOrders.map((order) => order.id))
            );
            return [...current.filter((order) => !cancelled.has(order.id)), ...fresh];
          });
        })
        .catch(() => undefined);
    };
    refresh();
    const unsubscribe = subscribeSales(refresh);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const activeSaleClients: ClientRecord[] = clientDirectory
    .filter((client) => client.status === 'ativo')
    .map((client) => ({
      id: client.id,
      name: client.name || client.company,
      company: client.company || client.name,
      initials: client.initials,
      accentColor: client.accentColor,
      email: client.email,
      phone: client.phone,
      document: client.document,
      city: client.city,
      totalSpent: 0,
      ordersCount: 0,
      activeProjects: 0,
      lastActivity: '',
    }));

  const pageMeta = getNavMeta(activePage);

  const handleSelectPage = (page: NavPageId) => {
    if (page === 'production') setProductionFocus(null);
    setActivePage(page);
    setBreadcrumb(null);
  };

  const handleOpenProduction = (focus: ProductionFocus) => {
    const labels: Record<ProductionFocus, string> = {
      aprovacao: 'Aguardando aprovação',
      em_producao: 'Em produção',
      pronto: 'Pronto para entrega',
      atrasados: 'Atrasados',
    };
    setProductionFocus(focus);
    setActivePage('production');
    setBreadcrumb(labels[focus]);
  };

  const handleUpdateOrderStatus = (orderId: string, status: ProductionStatus) => {
    setOrders((prev) =>
      prev.map((order) => (order.id === orderId ? { ...order, status } : order))
    );
  };

  const handleRegisterSale = (sale: SaleRecord) => {
    setSales((prev) => [sale, ...prev]);
  };

  const handleAddExpense = (expense: ExpenseRecord) => {
    setExpenses((prev) => [expense, ...prev]);
  };

  const handleMarkAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, unread: false })));
  };

  const handleNotificationClick = (page: NavPageId, notificationId: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, unread: false } : n))
    );
    handleSelectPage(page);
  };

  if (signedOut) {
    return (
      <div className="min-h-screen bg-[#F6F8FB] flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white border border-[#E4EAF1] rounded-lg p-6 text-center space-y-4 shadow-sm">
          <div className="flex justify-center">
            <BaruchLogo size={44} />
          </div>
          <div>
            <h1 className="text-[16px] font-semibold text-[#071A34] tracking-[0.06em]">
              BARUCH
            </h1>
            <p className="text-[12.5px] text-[#5A6B82] mt-1">
              Sessão encerrada com segurança.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setSignedOut(false);
              setActivePage('dashboard');
            }}
            className="w-full h-9 rounded-md bg-[#071A34] text-white text-[13px] font-medium hover:bg-[#0D284D] transition-colors"
          >
            Entrar novamente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F6F8FB] text-[#0F1E36]">
      <Sidebar
        activePage={activePage}
        collapsed={sidebarCollapsed}
        onSelectPage={handleSelectPage}
        onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
        onLogout={() => setSignedOut(true)}
        userName={CURRENT_USER.name}
        userRole={CURRENT_USER.role}
        userInitials={CURRENT_USER.initials}
      />

      <div
        className={`min-h-screen flex flex-col transition-[padding-left] duration-200 ease-out ${
          sidebarCollapsed ? 'pl-[70px]' : 'pl-[252px]'
        }`}
      >
        <Topbar
          pageTitle={pageMeta.label}
          breadcrumb={breadcrumb}
          globalSearch={globalSearch}
          onGlobalSearchChange={setGlobalSearch}
          notifications={notifications}
          onMarkAllRead={handleMarkAllRead}
          onNotificationClick={handleNotificationClick}
          onOpenSettings={() => handleSelectPage('settings')}
          userName={CURRENT_USER.name}
          userRole={CURRENT_USER.role}
          userInitials={CURRENT_USER.initials}
        />

        <main className="flex-1 w-full px-6 py-6">
          {activePage === 'dashboard' && (
            <DashboardPage onOpenProduction={handleOpenProduction} />
          )}
          {activePage === 'chat_projects' && (
            <ChatProjectsPage
              globalSearch={globalSearch}
              onBreadcrumbChange={setBreadcrumb}
              requestedClientId={chatRequest}
              onRequestedClientHandled={() => setChatRequest(null)}
            />
          )}
          {activePage === 'products' && <ProductsPage globalSearch={globalSearch} />}
          {activePage === 'clients' && (
            <ClientsPage
              globalSearch={globalSearch}
              onBreadcrumbChange={setBreadcrumb}
              onNavigate={handleSelectPage}
              sales={sales}
              onOpenChat={(clientId) => {
                setChatRequest(clientId);
                handleSelectPage('chat_projects');
              }}
            />
          )}
          {activePage === 'sales' && (
            <SalesPage
              sales={sales}
              onRegisterSale={handleRegisterSale}
              clients={activeSaleClients}
            />
          )}
          {activePage === 'reports' && <ReportsPage />}
          {activePage === 'production' && (
            <ProductionPage
              orders={orders}
              onUpdateStatus={handleUpdateOrderStatus}
              focus={productionFocus}
            />
          )}
          {activePage === 'expenses' && (
            <ExpensesPage expenses={expenses} onAddExpense={handleAddExpense} />
          )}
          {activePage === 'files' && <FilesPage globalSearch={globalSearch} />}
          {activePage === 'settings' && (
            <SettingsPage
              userName={CURRENT_USER.name}
              userRole={CURRENT_USER.role}
            />
          )}
        </main>
      </div>
    </div>
  );
}
