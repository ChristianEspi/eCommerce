# Cheatsheet del operador (1 página)

RC `23228c5` · tienda `<slug>` (documentada: `miquimica`) · host `<HOST>` · **sin contraseñas aquí**

```text
ANTES DE EMPEZAR
[ ] QAS abre  (<HOST>/s/<slug> y F5 en <HOST>/s/<slug>/cart no da 404)
[ ] smoke:qas PASS · DEMO_PREFLIGHT_RC PASS (del día)
[ ] login Consumer       (ventana 2)
[ ] login Trade          (ventana 3)
[ ] login Enterprise     (ventana 4)  [ ] Multi si se enseña «Cambiar cuenta»
[ ] login Admin          (ventana 5, rol de pedidos)
[ ] producto demo con stock  +  producto alternativo con stock
[ ] promociones vigentes (pública y, si se enseña, dirigida)
[ ] OC: la cuenta Enterprise la exige (si se enseña)
[ ] deep links: /s/<slug>/product/<p>, /cart, /checkout, /account recargan bien
[ ] carritos vacíos · pestañas de DevTools cerradas · notificaciones del SO silenciadas

DEMO
1. Theme       /s/<slug>  →  /app/settings#design (vista previa, NO guardar)
2. Consumer    categoría → buscar → PDP → carrito → Finalizar compra → Transferencia → Pedido registrado
               Tu cuenta → Mis pedidos · Mis direcciones · Mis favoritos · móvil 390
3. Trade       barra «Cuenta comercial» → «Tu precio comercial» vs público → cantidad → carrito → pedido
4. Enterprise  «Comprando para» → [Cambiar cuenta A/B] → convenio → carrito → OC → pedido → portal
5. Backoffice  /app/orders → /app/customers#cuentas → /app/pricing#simulador → /app/settings#branding → /app/content

NO MOSTRAR
- Employee Commerce como terminado (solo roadmap)
- secretos, .env, consola de Supabase/Amplify, DevTools con tokens
- pantallas incompletas: «emitir» comprobantes, PDF de OC, WYSIWYG, self-service Trade
- dependencias externas no configuradas: pasarela de tarjeta, correo («le llega un correo»), IA por concepto
- crédito en Trade · guardar el tema en vivo · crear datos en vivo
```

## Rutas útiles

| Vitrina | Backoffice |
|---|---|
| `/s/<slug>` portada · `?ver=todo` catálogo | `/app` panel |
| `/s/<slug>/product/<producto>` | `/app/orders` pedidos |
| `/s/<slug>/cart` · `/checkout` | `/app/customers#cuentas` Cuentas B2B |
| `/s/<slug>/order/<número>` confirmación | `/app/pricing#listas` · `#simulador` |
| `/s/<slug>/account` · `#pedidos` `#direcciones` `#favoritos` `#datos` `#avisos` | `/app/promotions` |
| `/s/<slug>/favoritos` | `/app/settings#branding` · `#design` |
| `/s/<slug>/register` alta de consumidor | `/app/content` CMS / Home |
| `/s/<slug>/p/<página>` página CMS | `/app/credit` · `/app/planning` (opcional) |
| `/login` · `/recuperar` | |

## Reglas de oro

- Pedido nuevo en backoffice: solo **pendiente → pagado**.
- Pago: **Transferencia bancaria**. Apunta cada número de pedido.
- Si algo falla: **no depures en vivo** → [`DEMO_RECOVERY.md`](DEMO_RECOVERY.md).
