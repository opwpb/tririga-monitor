# TRIVIS Server Deployment Guide
This guide explains how to connect to the **TRIVIS** server and deploy new applications or content.
---
> [!CAUTION]
> ### 🚨 THE GOLDEN RULE OF TRIVIS DEPLOYMENT
> **DO NOT MODIFY, OVERWRITE, OR DELETE ANY FILES IN THE ROOT DIRECTORY (`webapps/ROOT/`).**
>
> TRIVIS is a shared **Apache Tomcat** application server hosting critical corporate tools and TRIRIGA services. Touching files in the root folder (`index.jsp`, root `WEB-INF`, root icons, or shared configs) can take down existing production services for all users.
>
> **Every application MUST live exclusively inside its own dedicated subfolder.**
---
## 1. Full Server Paths & Access
* **Server Type**: Apache Tomcat Web Application Server (Tomcat 10.1+ / Java 17).
* **Full Network Share Path (UNC `c$` share)**:
  ```text
  \\trivis\c$\Program Files\Apache Software Foundation\Tomcat 10.1\webapps\ROOT\
  ```
* **Local Server Path (when on TRIVIS via RDP)**:
  ```text
  C:\Program Files\Apache Software Foundation\Tomcat 10.1\webapps\ROOT\
  ```
* **Application Subfolder Path**:
  ```text
  \\trivis\c$\Program Files\Apache Software Foundation\Tomcat 10.1\webapps\ROOT\<app-name>\
  ```
* **How URLs Map to Folders**:
  Tomcat maps any subfolder under `webapps/ROOT/` directly to that URL path:
  * Subfolder: `webapps/ROOT/maptest/` ➔ URL: `https://trivis/maptest/`
  * Subfolder: `webapps/ROOT/energy/`  ➔ URL: `https://trivis/energy/`
  * Subfolder: `webapps/ROOT/leasing/` ➔ URL: `https://trivis/leasing/`
---
## 2. Directory Structure on TRIVIS
```text
Tomcat 10.1/webapps/ROOT/
│
├── [DO NOT TOUCH / DO NOT MODIFY ROOT FILES]
│   ├── index.jsp                  <-- DO NOT MODIFY
│   ├── favicon.ico                <-- DO NOT MODIFY
│   └── WEB-INF/                   <-- DO NOT OVERWRITE (Merge only if needed)
│
├── maptest/                       <-- APP SUBFOLDER (Safe sandbox)
│   ├── index.html
│   ├── datareview.html
│   ├── valuation.html
│   ├── environmental.html
│   ├── admin.html
│   ├── properties.csv
│   ├── buildings.csv
│   ├── css/
│   ├── js/
│   ├── data/gis/
```
