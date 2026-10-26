# MIODesign — manutenzione dati

Interfaccia web (HTML/JS statico, nessuna build) per la manutenzione dei dati di MIODesign (Parte II di `../analisi.pdf`), con database su Supabase. MIO Light non fa parte di questo progetto.

## Funzioni
- **Login** con Supabase Auth (email/password).
- **Menu iniziale**: Anagrafica prodotti, Anagrafica attributi/opzioni.
- **Anagrafica prodotti**: elenco, creazione (ID progressivo automatico), modifica, eliminazione; per ogni prodotto misure (terne X/Y/Z) e attributi assegnati con opzioni ammesse, default, ordine, obbligatorietà.
- **Anagrafica attributi/opzioni**: elenco attributi con relative opzioni; creazione/modifica/eliminazione di attributi generali e derivati, opzioni (materiale o visibilità, ordine, attiva), selezione del sottoinsieme di opzioni per i derivati.

## Setup
1. Crea un progetto su Supabase ed esegui `supabase/schema.sql` nello SQL Editor (crea le 16 tabelle della Parte III, i trigger di integrità e le policy RLS).
2. In *Authentication > Users* crea gli utenti che potranno accedere.
3. Inserisci Project URL e anon key in `config.js`.
4. Servi la cartella con un server statico, ad es. `python3 -m http.server 4174`, e apri `http://localhost:4174/`.

## Note
- `materiali.id_glb` è facoltativo (scostamento dal documento) per poter creare materiali prima del caricamento dei GLB.
- Il database include già anche le tabelle per GLB/mesh, matrice codice/prezzo, listini e versioni; le relative maschere non sono ancora realizzate.
