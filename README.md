# FMT - Filament Management Tool

Ein browserbasiertes Tool zur Verwaltung Ihres 3D-Druck-Filamentbestands. Verfolgen Sie Spulen mit detaillierten Daten, organisieren Sie sie in einem hierarchischen Lagersystem und nutzen Sie Ihre Kamera zum Scannen von QR-Codes für schnellen Zugriff. Inklusive druckbarer Etiketten für Spulen und Lagerplätze.

![App Screenshot](https://user-images.githubusercontent.com/12345/placeholder.jpg) 
*(Platzhalter für einen Screenshot der Hauptansicht)*

---

## Warum dieses Tool?

Dieses Tool wurde entwickelt, um eine häufige Herausforderung für 3D-Druck-Enthusiasten zu lösen: die Organisation und Verfolgung des Filamentbestands. Anstatt sich auf Tabellenkalkulationen oder Notizen zu verlassen, bietet FMT eine integrierte, visuelle und effiziente Lösung, die direkt im Browser läuft. Der wichtigste Grundsatz ist dabei **Datenschutz und Unabhängigkeit**: Alle Ihre Daten bleiben bei Ihnen, es gibt keine Cloud, kein Konto und keine Server-Kommunikation.

## Hauptfunktionen

-   **Lokale Datenspeicherung:** Alle Daten werden ausschließlich im lokalen Speicher Ihres Browsers gespeichert. Nichts verlässt jemals Ihren Computer.
-   **Umfassende Spulen-Datenbank:** Erfassen Sie alles von Hersteller und Farbe bis hin zu Gewicht, Restlänge, Drucktemperaturen und Herstellungsdatum.
-   **Hierarchische Lagerverwaltung:** Organisieren Sie Ihr Filament in einer benutzerdefinierten Baumstruktur (z.B. `Regal 1 > Fach A > Box 3`).
-   **QR-Code-Integration:**
    -   Generieren und drucken Sie einzigartige QR-Code-Etiketten für jede Filamentspule.
    -   Erstellen Sie Etiketten für jeden Lagerort.
    -   Verwenden Sie die Kamera Ihres Geräts, um einen Code zu scannen und sofort die Spulendetails aufzurufen oder die Ansicht nach einem Lagerort zu filtern.
-   **Etikettendruck:** Drucken Sie professionell aussehende Etiketten für Ihre Spulen und Lagerbehälter direkt aus der App. Die Etiketten sind für Standard-Etikettendrucker (z.B. 70x37mm) optimiert, können aber auch auf normalem Papier gedruckt werden.
-   **Import / Export:** Sichern Sie Ihre gesamte Datenbank in einer einzigen `JSON`-Datei. Ideal für Backups oder die Übertragung auf ein anderes Gerät.
-   **Intelligente Berechnungen:** Die App berechnet automatisch die verbleibende Filamentlänge basierend auf dem aktuellen Gewicht und dem Materialtyp (Dichte).

---

## Entwicklungsumgebung einrichten

Diese Anwendung basiert auf React und TypeScript und erfordert Node.js für die lokale Entwicklung.

**Voraussetzungen:**
-   [Node.js](https://nodejs.org/en/) (Version 18.x oder neuer empfohlen)
-   npm (wird mit Node.js installiert)
-   [Git](https://git-scm.com/downloads/)

### Vom Drag & Drop zum Git-Workflow (Einmalige Einrichtung)

Wenn Sie bisher Dateien per Drag & Drop auf GitHub hochgeladen haben, hilft Ihnen diese Anleitung, Ihren lokalen Projektordner einmalig mit GitHub zu verbinden. Danach wird das Aktualisieren Ihres Projekts viel einfacher und sicherer.

**Schritt 1: Git installieren**
Falls noch nicht geschehen, installieren Sie Git von der [offiziellen Webseite](https://git-scm.com/downloads/).

**Schritt 2: Lokalen Ordner mit GitHub verbinden**
Öffnen Sie ein Terminal (oder eine Kommandozeile/PowerShell) **direkt in Ihrem Projektordner** und führen Sie die folgenden Befehle nacheinander aus.

1.  **Git-Repository initialisieren:**
    Dieser Befehl erstellt ein verstecktes `.git`-Verzeichnis in Ihrem Projektordner und macht ihn zu einem Git-Repository.
    ```bash
    git init -b main
    ```

2.  **Verbindung zum GitHub-Repository herstellen:**
    Teilen Sie Git die URL Ihres GitHub-Projekts mit. Ersetzen Sie `IHR_BENUTZERNAME/IHR_REPOSITORY` durch Ihre tatsächlichen Daten.
    ```bash
    git remote add origin https://github.com/IHR_BENUTZERNAME/IHR_REPOSITORY.git
    ```

3.  **Alle Dateien zum ersten "Commit" hinzufügen:**
    Dieser Befehl bereitet alle Dateien in Ihrem Ordner für den ersten Upload vor.
    ```bash
    git add .
    ```

4.  **Den ersten "Commit" erstellen:**
    Ein "Commit" ist ein permanenter Schnappschuss Ihrer Änderungen. Geben Sie ihm eine aussagekräftige Nachricht.
    ```bash
    git commit -m "Initial project setup"
    ```

5.  **Alles nach GitHub hochladen:**
    Dieser Befehl lädt Ihre Dateien zum ersten Mal auf GitHub hoch und legt fest, dass Ihr lokaler `main`-Branch dem `main`-Branch auf GitHub entspricht.
    ```bash
    git push -u origin main
    ```

**Fertig!** Ihr lokaler Ordner ist nun mit GitHub verbunden.

### Lokale Entwicklung

Nach der einmaligen Einrichtung benötigen Sie nur noch die folgenden Befehle:

1.  **Abhängigkeiten installieren (nur einmalig nötig):**
    Führen Sie diesen Befehl im Hauptverzeichnis des Projekts aus. Er lädt alle notwendigen Bibliotheken (React, Vite etc.) herunter.
    ```bash
    npm install
    ```

2.  **Entwicklungsserver starten:**
    Dieser Befehl startet einen lokalen Server, öffnet die App in Ihrem Browser und aktualisiert sie automatisch, wenn Sie Änderungen am Code vornehmen.
    ```bash
    npm run dev
    ```

### Änderungen auf GitHub hochladen (Ihr neuer Standard-Workflow)

Nachdem Sie Änderungen am Code vorgenommen haben, ersetzen Sie den alten Drag & Drop-Prozess durch diesen einfachen Dreischritt im Terminal:

```bash
# 1. Alle geänderten Dateien vormerken
git add .

# 2. Einen Schnappschuss mit einer Beschreibung erstellen
git commit -m "Eine kurze Beschreibung Ihrer Änderungen"

# 3. Den Schnappschuss nach GitHub hochladen
git push
```

---

## Automatische Bereitstellung (Deployment) auf GitHub Pages

Dieses Projekt ist so konfiguriert, dass es bei jedem `git push` auf den `main`-Branch automatisch gebaut und auf GitHub Pages veröffentlicht wird. Sie müssen dies nur einmalig in den Repository-Einstellungen aktivieren.

1.  Gehen Sie zu Ihrem Repository auf GitHub und klicken Sie auf **Settings**.
2.  Wählen Sie im Menü links **Pages**.
3.  Unter "Build and deployment" ändern Sie die Quelle ("Source") auf **GitHub Actions**.

![GitHub Pages Actions Settings](https://docs.github.com/assets/cb-129639/images/help/pages/build-with-actions-source.png)

Das ist alles! Nach dem nächsten `git push` wird die "Action" gestartet. Es kann einige Minuten dauern, bis Ihre Seite unter der angezeigten URL (z.B. `https://ihr-name.github.io/ihr-repo/`) erreichbar ist. Sie müssen nie wieder manuell einen `dist`-Ordner erstellen oder hochladen.

---

## Aktueller Entwicklungsstand & Bekannte Probleme

-   **Scanner-Navigation:** Die QR-Code-Erkennung kann je nach Gerät, Browser und Lichtverhältnissen variieren.
-   **SVG-Export für Etiketten:** Der Export der Etiketten als SVG-Datei ist experimentell und das Layout ist möglicherweise noch nicht perfekt.

## Lizenz

Dieses Projekt ist unter der MIT-Lizenz lizenziert.
