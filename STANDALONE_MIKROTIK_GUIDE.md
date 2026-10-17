# Standalone MikroTik Integration & Local Execution Guide

This guide explains how to run the NetPulse ISP NOC backend locally so it can establish direct, real TCP/TLS socket communication with your physical or virtual MikroTik RouterOS v7 device over port 8728 (or 8729 for SSL).

---

## 1. Prerequisites on the MikroTik Router

To allow the Node.js backend to query live data, ensure the RouterOS API service is enabled and credentials are configured.

### Step 1.1: Enable RouterOS API Service
Open WinBox, WebFig, or SSH into your MikroTik router and run:

```routeros
# Enable standard API on port 8728
/ip service enable api
/ip service set api port=8728

# (Optional) Enable API-SSL on port 8729 if you require TLS
/ip service enable api-ssl
/ip service set api-ssl port=8729
```

Verify the service is active:
```routeros
/ip service print
```
Ensure `api` (and optionally `api-ssl`) does not show the `X` (disabled) flag.

### Step 1.2: Check Firewall Rules
Ensure port 8728 is not blocked in `/ip firewall filter`:
```routeros
# Allow API from your local subnet (e.g., 192.168.88.0/24)
/ip firewall filter add chain=input protocol=tcp dst-port=8728 action=accept comment="Allow NetPulse RouterOS API"
```

### Step 1.3: Create or Verify API User
Create a dedicated user with `read` and `write` policy (or `full` group):
```routeros
/user add name=netpulse group=full password=YourStrongPassword comment="NetPulse NOC Controller"
```

---

## 2. Local Setup & Execution

### Step 2.1: Clone & Install Dependencies
In your local terminal:
```bash
git clone <repository_url>
cd <project_folder>
npm install
```

### Step 2.2: Configure `.env`
Create a `.env` file in the project root:
```bash
cp .env.example .env
```

Configure your parameters in `.env`:
```env
PORT=3000

# Optional PostgreSQL database (if omitted, data persists in data/routers.json and data/router_secrets.json)
# DATABASE_URL="postgresql://postgres:password@localhost:5432/netpulse_isp"
```

### Step 2.3: Start Local Dev Server
```bash
npm run dev
```

The Express server with Vite middleware starts on:
```
http://localhost:3000
```

---

## 3. Verify Real Communication with MikroTik

Open `http://localhost:3000` in your browser:
1. Navigate to **MikroTik Management** -> Click **+ Add Router**.
2. Enter your physical MikroTik router details:
   - **IP Address / Hostname**: `192.168.88.1` (or your static router IP)
   - **API Port**: `8728`
   - **API Username**: `netpulse` (or `admin`)
   - **API Password**: `YourStrongPassword`
   - **TLS / SSL**: unchecked for port 8728, checked for 8729
3. Click **Test Connection**:
   - The backend directly executes `api.connect()` via `node-routeros`.
   - On success: Returns real identity (e.g., `CCR2004`), architecture, CPU load, and active PPPoE count.
   - On failure: Displays the exact socket/auth failure error (e.g., `Connection refused on port 8728`, `Invalid credentials`, or `Timed out`).
4. Click **Save Router**:
   - The device is persisted in PostgreSQL or `data/routers.json`.
   - The real-time live sync automatically polls `/ppp/active`, `/interface/monitor-traffic`, and `/system/resource` every 4 seconds.
   - Active sessions and live bandwidth are mapped directly to the dashboard with **zero mock data**.

---

## 4. API Endpoints Reference

| Endpoint | Method | Description |
|---|---|---|
| `/api/routers` | `GET` | Fetches all saved routers from PostgreSQL / disk |
| `/api/routers` | `POST` | Probes real connection and saves router credentials |
| `/api/mikrotik/test` | `POST` | Performs live connection & health test (`/system/resource/print`, `/system/identity/print`) |
| `/api/mikrotik/sync` | `GET / POST` | Retrieves real active PPPoE sessions (`/ppp/active/print`), WAN traffic (`/interface/monitor-traffic`), and router health |
| `/api/mikrotik/kick` | `POST` | Disconnects an active PPPoE session (`/ppp/active/remove`) |
