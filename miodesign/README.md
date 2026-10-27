# MIODesign — manutenzione dati

Interfaccia web (HTML/JS statico, nessuna build) per la manutenzione dei dati di MIODesign (Parte II di `../analisi.pdf`), con database su Supabase. MIO Light non fa parte di questo progetto.

## Funzioni
- **Login** con Supabase Auth (email/password).
- **Menu iniziale**: Anagrafica prodotti, Anagrafica attributi/opzioni, Anagrafica materiali.
- **Anagrafica prodotti**: elenco, creazione (ID progressivo automatico), modifica, eliminazione; per ogni prodotto misure (terne X/Y/Z), GLB per misura e attributi assegnati con opzioni ammesse, default, ordine, obbligatorietà.
- **GLB e mesh**: caricamento automatico del GLB di oggetto quando si seleziona un file per una terna di misure; ogni GLB ha una mappatura mesh-attributo indipendente, senza richiedere mesh uguali tra misure.
- **Salvataggio unico**: in prodotti, attributi/opzioni e materiali un solo pulsante “Salva tutto” (barra fissa in basso) salva tutte le modifiche della pagina; le eliminazioni restano immediate. I GLB caricati vengono associati al salvataggio.
- **Interfaccia**: tema scuro; i file GLB si caricano automaticamente dopo la selezione dal pulsante “Carica GLB”.
- **Prova configurazione**: anteprima 3D del GLB di una misura; modificando gli attributi assegnati alle mesh vengono applicati i materiali GLB selezionati o le regole di visibilità.
- **Anagrafica materiali**: definizione di nome, descrizione e riferimento interno, con associazione facoltativa a un GLB di materiale; le opzioni degli attributi possono usare questi materiali.
- **Codici e prezzi** (`#/codifica`): scelto un prodotto, mostra tutte le combinazioni misura × opzioni ammesse degli attributi e permette di assegnare codice commerciale, descrizione e prezzo (per listino; se non esiste viene creato “Listino base”). Salvataggio con “Salva tutto”; righe svuotate vengono eliminate. Limite: 5000 combinazioni per prodotto.
- **Test prodotto** (`#/test`): scelta di prodotto, misura e listino, configurazione degli attributi e visualizzazione di codice, descrizione e prezzo della combinazione insieme all'anteprima 3D (circa 70% della larghezza).
- **Anagrafica attributi/opzioni**: elenco attributi con relative opzioni; creazione/modifica/eliminazione di attributi generali e derivati, opzioni (materiale o visibilità, ordine, attiva), selezione del sottoinsieme di opzioni per i derivati.

## Setup
1. Crea un progetto su Supabase ed esegui `supabase/schema.sql` nello SQL Editor (crea le tabelle, i trigger di integrità, le policy RLS e il bucket privato `modelli-glb` con le policy Storage). Se lo schema è già installato, applica solo il blocco `Archivio privato dei GLB` in fondo al file.
2. In *Authentication > Users* crea gli utenti che potranno accedere.
3. Inserisci Project URL e anon key in `config.js`.
4. Servi la cartella con un server statico, ad es. `python3 -m http.server 4174`, e apri `http://localhost:4174/`.

## Note
- `materiali.id_glb` è facoltativo per poter creare materiali prima del caricamento dei GLB.
- Codifica, prezzi e listini usano le tabelle già presenti nello schema (nessuna modifica SQL richiesta); le versioni di pubblicazione non hanno ancora una maschera.
