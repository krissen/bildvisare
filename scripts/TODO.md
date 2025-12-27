# nef2jpg.py Improvements TODO

## Prioritet 1 - Kritiskt ✅ COMPLETED

### Felhantering
- [x] Lägg till try/except runt `rawpy.imread()` för att hantera korrupta NEF-filer
- [x] Lägg till try/except runt `img.save()` för att hantera disk full/permissions
- [x] Lägg till try/except runt `json.dump()` för att hantera write failures
- [x] Lägg till lämpliga felmeddelanden för varje exception-typ

### Bugfixar
- [x] Fixa rad 44: Ändra `"exported": "true"` till `"exported": true` (boolean)

### Kodstil
- [x] Översätt rad 11: "Installera rawpy och pillow!" → English
- [x] Översätt rad 23: "Filen finns ej" → English
- [x] Översätt rad 26 kommentar: "Läs NEF, konvertera till RGB" → English
- [x] Översätt alla andra svenska kommentarer/strängar → English

### Improvements Made
- Added comprehensive error handling with specific exit codes (4-7)
- Fixed boolean value bug (line 64)
- Translated all Swedish text to English
- Added helpful error messages for each failure scenario
- Status file write failures are now warnings (conversion still succeeds)

## Prioritet 2 - Rekommenderat

### Validering
- [ ] Validera att input-fil har .NEF eller .nef extension
- [ ] Validera att output-path är säker (inte systemfiler)
- [ ] Lägg till check för min/max filstorlek

### Dokumentation
- [ ] Lägg till module-level docstring
- [ ] Lägg till docstring för `main()` funktion
- [ ] Dokumentera exit codes (0=success, 1=import error, 2=usage error, 3=file not found, etc.)
- [ ] Lägg till kommentarer för varje större kodblock

### Logging
- [ ] Lägg till optional verbose mode (`--verbose` flag)
- [ ] Logga conversion start/end timestamps
- [ ] Logga filstorlekar (input NEF, output JPG)

## Prioritet 3 - Nice to have

### Konfigurabilitet
- [ ] Gör quality konfigurerbar via argument (default: 98)
- [ ] Lägg till `--quality` argument/flag
- [ ] Överväg config-fil för standardinställningar

### Performance & UX
- [ ] Lägg till progress feedback för stora filer (>10MB)
- [ ] Överväg att visa estimerad tid kvar
- [ ] Optimera för snabbare konvertering (om möjligt)

### Code Quality
- [ ] Lägg till type hints (Python 3.5+)
- [ ] Överväg att bryta ut konverteringslogik till separat funktion
- [ ] Överväg att bryta ut status-writing till separat funktion
- [ ] Lägg till unit tests

## Testing Checklist

Efter ändringar, testa:
- [ ] Normal konvertering: NEF → JPG fungerar
- [ ] Felhantering: Korrupt NEF-fil ger användbart felmeddelande
- [ ] Felhantering: Icke-existerande fil ger rätt exit code
- [ ] Felhantering: Ogiltigt output path hanteras
- [ ] Status-fil skrivs korrekt med boolean (inte sträng)
- [ ] Integration: Bildvisare kan använda konverterad fil
- [ ] Integration: 'O'-tangent triggar konvertering korrekt

## Notes

- Scriptet anropas från `main.js` rad 42-46
- Python interpreter: hardcoded till hitta_ansikten conda env
- Output status fil: `~/Library/Application Support/bildvisare/original_status.json`
- Används av bildvisare för att trigga slave viewer
