// pouls.js : a importer depuis chaque service qui doit tenir un carre au tableau.
//
// Ce fichier est fourni par le sujet du jour 5 et depose ici tel quel : le
// reecrire couterait une heure par equipage pour un resultat strictement
// identique. Les quatre services de la flotte l'importent, seules les variables
// d'environnement changent d'un service a l'autre.
import os from "node:os";
import fs from "node:fs";

const TABLEAU = process.env.TABLEAU_URL;
const GROUPE = process.env.GROUPE;
const COULEUR = process.env.COULEUR || "#888888";
const SERVICE = process.env.SERVICE;
const VERSION = process.env.VERSION || "dev";
const PAVILLON = process.env.PAVILLON_FICHIER || "/data/pavillon.txt";
const MOI = process.env.URL_INTERNE || "http://localhost:3000";

let totalEncaisse = 0; // depuis le demarrage de ce process, affiche sur le carre
let aDeclarer = 0; // encaisses depuis le dernier pouls, ce que le tableau attend

// Le pavillon est relu du disque a chaque pouls : s'il vit dans un volume, il
// traverse le redeploiement, sinon il disparait du tableau devant toute la classe.
function lirePavillon() {
    try {
        return fs.readFileSync(PAVILLON, "utf8").trim();
    } catch {
        return "";
    }
}

// Un coup, c'est une vraie requete sur sa propre route de travail. Les coups partent
// par paquets de dix en parallele, sinon un gros retard bloquerait le pouls suivant.
async function encaisser(nombre) {
    const aFaire = Math.min(nombre, 300);
    for (let debut = 0; debut < aFaire; debut += 10) {
        const paquet = [];
        for (let i = debut; i < Math.min(debut + 10, aFaire); i++) {
            paquet.push(
                fetch(`${MOI}/travail`)
                    .then((reponse) => {
                        if (reponse.ok) {
                            totalEncaisse++;
                            aDeclarer++;
                        }
                    })
                    .catch(() => {})
            );
        }
        await Promise.all(paquet);
    }
}

async function envoyerPouls() {
    let attente = 5000;
    const declares = aDeclarer;
    try {
        const reponse = await fetch(`${TABLEAU}/api/pouls`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                groupe: GROUPE,
                couleur: COULEUR,
                service: SERVICE,
                pod: os.hostname(),
                version: VERSION,
                pavillon: lirePavillon(),
                encaisses: declares,
                total_encaisse: totalEncaisse,
            }),
        });
        // Les coups declares ne sont retires du compteur local qu'une fois le tableau
        // au courant : si l'appel echoue, ils repartiront dans le pouls suivant.
        aDeclarer -= declares;
        const ordre = await reponse.json();
        attente = ordre.prochain_pouls_ms || 5000;
        if (ordre.coups_a_encaisser > 0) await encaisser(ordre.coups_a_encaisser);
    } catch (erreur) {
        console.error("[pouls] tableau injoignable :", erreur.message);
    }
    setTimeout(envoyerPouls, attente);
}

export function demarrerLePouls() {
    if (!TABLEAU || !GROUPE || !SERVICE) {
        console.error("[pouls] TABLEAU_URL, GROUPE et SERVICE sont obligatoires");
        return;
    }
    console.log(`[pouls] ${GROUPE}/${SERVICE} vers ${TABLEAU}`);
    envoyerPouls();
}
