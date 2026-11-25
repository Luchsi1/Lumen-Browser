# Anleitung: Lumen als .exe bauen (GitHub Actions)

Du brauchst nur einen Browser und ein kostenloses GitHub-Konto. Windows musst du nicht selbst bedienen, GitHub baut die Dateien auf einem Windows-Server.

## 1. Konto und Repository
1. Auf https://github.com ein Konto anlegen (kostenlos) und anmelden.
2. Oben rechts auf **+** und **New repository** klicken. Name zum Beispiel `lumen-browser`. **Private** wählen, wenn niemand den Code sehen soll. **Create repository**.

## 2. Dateien hochladen
1. Entpacke das Projekt-Archiv (`lumen-browser.zip`) auf deinem Computer.
2. Im neuen Repository auf **uploading an existing file** klicken.
3. Ziehe den **Inhalt** des Ordners `lumen-browser` in das Browserfenster (nicht den Ordner selbst). Wichtig: der versteckte Ordner `.github` muss dabei sein. Wenn er beim Ziehen fehlt, den Ordner `.github` einzeln hinaufziehen. Die Ordner `node_modules`, `dist` und `release` werden **nicht** gebraucht.
4. Unten **Commit changes** klicken.

Tipp: Wenn der Upload von vielen Dateien Probleme macht, GitHub Desktop (https://desktop.github.com) verwenden: Repository klonen, Dateien hineinkopieren, **Commit** und **Push**.

## 3. Build starten
1. Im Repository oben auf **Actions** klicken. Falls gefragt, Workflows aktivieren.
2. Links **Build Windows installer** wählen, rechts **Run workflow**, dann den grünen Knopf.
3. Warte etwa 5 bis 10 Minuten. Ein grüner Haken bedeutet Erfolg, ein rotes Kreuz einen Fehler.

## 4. Dateien herunterladen
1. Auf den fertigen Lauf klicken.
2. Unten unter **Artifacts** auf **Lumen-windows** klicken. Du bekommst eine ZIP-Datei.
3. Darin liegen:
   - `Lumen-Setup-1.0.0-x64.exe`: Installer
   - `Lumen-1.0.0-portable.exe`: läuft ohne Installation

## 5. Erster Start
Windows zeigt "Der Computer wurde durch Windows geschützt", weil die Datei nicht signiert ist. Klicke auf **Weitere Informationen**, dann **Trotzdem ausführen**.

## Wenn etwas fehlschlägt
Klicke auf den roten Lauf, dann auf den Schritt mit dem roten Kreuz, und kopiere die letzten 30 Zeilen der Ausgabe zu mir in den Chat. Ich behebe den Fehler.
Wichtig: Dieser Build wurde noch nie auf Windows ausgeführt. Fehler sind beim ersten Mal möglich.
