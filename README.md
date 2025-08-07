# FMT - Filament Management Tool

Ein browserbasiertes Tool zur Verwaltung Ihres 3D-Druck-Filamentbestands. Verfolgen Sie Spulen mit detaillierten Daten, organisieren Sie sie in einem hierarchischen Lagersystem und nutzen Sie Ihre Kamera zum Scannen von QR-Codes für schnellen Zugriff. Inklusive druckbarer Etiketten für Spulen und Lagerplätze.

![App Screenshot](https://github.com/remstalbasti/FMT-Filament-Managment-Tool/blob/main/FMT001.png) 
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
-   **Tabellenkalkulation** Sie können ohne Tabellenkalkulation nicht arbeiten? Einfach die .json in einem online konverter in das gewüschte Format wandeln.

## Geplante Funktionen
- Irgendwas mit KI

## Sonstiges
Mit der Druckvorlage kann eine Auflage für eine einfache digitale Waage gedruck werden.
![App Screenshot](https://github.com/remstalbasti/FMT-Filament-Managment-Tool/blob/main/print/20250803_172354.jpg) 
*(Platzhalter für einen Screenshot der Hauptansicht)*
Damit wird das erfassen des Gewichts und verbleiben Fialments zum Kinderspiel.


---

## Entwicklungsumgebung einrichten

Diese Anwendung basiert auf React und TypeScript und erfordert Node.js für die lokale Entwicklung.

**Voraussetzungen:**
-   [Node.js](https://nodejs.org/en/) (Version 18.x oder neuer empfohlen)
-   npm (wird mit Node.js installiert)

## 1. Abhängigkeiten installieren

Nachdem Sie die Daten in einem lokalen Ordner entpackt haben haben, öffnen Sie ein Terminal im Projektordner und führen Sie diesen Befehl aus. Er lädt alle notwendigen Bibliotheken (React, Vite etc.) herunter.

```bash
npm install
```

## 2. Entwicklungsserver starten

Dieser Befehl startet einen lokalen Server (meist auf `http://localhost:3000`), öffnet die App in Ihrem Browser und aktualisiert sie automatisch, wenn Sie Änderungen am Code vornehmen.

```bash
npm run dev
```
## Aktueller Entwicklungsstand & Bekannte Probleme

-   **Scanner-Navigation:** Die QR-Code-Erkennung kann je nach Gerät, Browser und Lichtverhältnissen variieren.
-   **SVG-Export für Etiketten:** Der Export der Etiketten als SVG-Datei ist experimentell und das Layout ist möglicherweise noch nicht perfekt.

## Lizenz

Dieses Projekt ist unter der MIT-Lizenz lizenziert.

## Und sonst noch

Wenn Dir das Projekt gefällt, watch or star me please
Thank you
