# MIODesign — manutenzione dati

Interfaccia web (HTML/JS statico, nessuna build) per la manutenzione dei dati di MIODesign (Parte II di `../analisi.pdf`), con database su Supabase. MIO Light non fa parte di questo progetto.

## Funzioni
- **Login** con Supabase Auth (email/password).
- **Menu iniziale**: Anagrafica prodotti, Anagrafica attributi/opzioni, Anagrafica materiali.
- **Anagrafica prodotti**: elenco, creazione (ID progressivo automatico), modifica, eliminazione; per ogni prodotto misure (terne X/Y/Z), GLB per misura e attributi assegnati con opzioni ammesse, default, ordine, obbligatorietà.
- **GLB e mesh**: caricamento del GLB di oggetto per ogni terna di misure; la mappatura mesh-attributo è condivisa dal prodotto e replicata sui GLB delle sue misure. I GLB dello stesso prodotto devono avere gli stessi percorsi mesh.
- **Anagrafica materiali**: definizione di nome, descrizione e riferimento interno, con associazione facoltativa a un GLB di materiale; le opzioni degli attributi possono usare questi materiali.
- **Anagrafica attributi/opzioni**: elenco attributi con relative opzioni; creazione/modifica/eliminazione di attributi generali e derivati, opzioni (materiale o visibilità, ordine, attiva), selezione del sottoinsieme di opzioni per i derivati.

## Setup
1. Crea un progetto su Supabase ed esegui `supabase/schema.sql` nello SQL Editor (crea le tabelle, i trigger di integrità, le policy RLS e il bucket privato `modelli-glb` con le policy Storage). Se lo schema è già installato, applica solo il blocco `Archivio privato dei GLB` in fondo al file.
2. In *Authentication > Users* crea gli utenti che potranno accedere.
3. Inserisci Project URL e anon key in `config.js`.
4. Servi la cartella con un server statico, ad es. `python3 -m http.server 4174`, e apri `http://localhost:4174/`.

## Note
- `materiali.id_glb` è facoltativo per poter creare materiali prima del caricamento dei GLB.
- Le tabelle per matrice codice/prezzo, listini e versioni sono presenti nello schema; le relative maschere non sono ancora realizzate.
