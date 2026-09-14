# Runtime de Node — contrato del Release Candidate (R03)

| | Versión | Dónde está escrito |
|---|---|---|
| Mínima | **Node ≥ 22.12** | `package.json` → `engines.node` (desde N08) |
| Recomendada | **Node 24 (LTS)** | `.nvmrc` (`24`) |
| Usada por este Release Candidate | **Node 24.20.0 / npm 11.19.0** | `docs/release-candidate/BASELINE.md` |

## Cómo se hace cumplir

- `.nvmrc` = `24`: `nvm use` / `fnm use` / `volta` (vía `.nvmrc`) y la mayoría de CI eligen Node 24.
- `.npmrc` = `engine-strict=true`: `npm ci` **falla** con `EBADENGINE` en un Node fuera de contrato en vez de
  construir con él. Verificado en una copia de `package.json` + `package-lock.json`:
  - Node 20.20.2 → `npm error code EBADENGINE … Not compatible with your version of node/npm` (se detiene);
  - Node 24.20.0 → instala 414 paquetes;
  - Node 25.9.0 → instala 414 paquetes.

Por qué 22.12 y no 20: Node 20 está fuera de soporte desde abril de 2026; la suite unitaria es verde en 24 y 25 (y
sigue pasando en 20, pero no se promete). No se cambió la versión mínima respecto a N08.

## AWS Amplify (fuera del repositorio)

El alojamiento es AWS Amplify (`customHttp.yml` en la raíz). **La configuración de build de Amplify no está en este
repositorio** (no hay `amplify.yml`) y **no se ha modificado**. Amplify no lee `.nvmrc` por sí solo. Pendiente en la
consola de la app, antes del próximo build de QAS:

- [ ] Fijar Node 24: *Build settings → Build image settings → Live package updates → Node.js version = 24*, o bien
  `nvm install 24 && nvm use 24` en `preBuild` de la especificación de build de la consola.
- [ ] Confirmar en el log del build: `node --version` → `v24.x`. Con `engine-strict`, un build con Node < 22.12 falla en
  `npm ci`: es el comportamiento buscado, no un fallo del código.

No se añadió `amplify.yml` al repositorio: sustituiría la especificación de build que hoy vive en la consola y no se
puede ver desde aquí.
