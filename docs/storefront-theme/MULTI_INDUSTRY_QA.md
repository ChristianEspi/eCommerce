# QA multirrubro del Theme Engine

Fecha: 2026-09-10 · Rama `dev` · Sin desplegar.

## La pregunta que responde este documento

¿Sirve el **mismo código** a cuatro negocios distintos, sin que ninguno de ellos
aparezca nombrado dentro del programa?

La respuesta corta es sí, y la prueba no es una captura de pantalla: es que el
archivo que valida los cuatro escenarios
(`src/features/storefront/theme/multi-industry.test.tsx`) **puede ser una tabla**.
Los cuatro rubros se declaran como cuatro filas de datos y el mismo bloque de
comprobaciones corre sobre las cuatro. Si el programa necesitara saber a qué se
dedica el comercio, esa tabla no existiría: haría falta una rama por fila.

## Los cuatro escenarios

| Rubro | Tema | Qué cambia de verdad |
|---|---|---|
| Moda y ropa | `premium` | Foto vertical, tres columnas, portada grande y aire de sobra |
| Zapatería y retail general | `universal` | Exactamente lo que la vitrina hacía antes del Theme Engine |
| Farmacia y droguería | `retail` | Tarjeta compacta, cinco columnas, precio con más peso |
| Abarrotes y distribución | `catalog` | Ancho extra, seis columnas, barra reducida, portada discreta |

Cada escenario se monta con **su propio catálogo** —su tienda, su lema, su
familia, su producto, con descuento o sin él— y se comprueba la tienda entera.

## Qué se validó en cada uno

| Comprobación | Resultado |
|---|---|
| La tienda se presenta con su identidad, no con la de la suite | PASA en los 4 |
| Encabezado de primer nivel presente | PASA en los 4 |
| Buscador alcanzable | PASA en los 4 |
| Navegación por familias | PASA en los 4 |
| Producto visible con su precio | PASA en los 4 |
| El descuento se anuncia **solo** si el producto lo tiene | PASA en los 4 |
| Se puede comprar (producto simple) | PASA en los 4 |
| Condiciones de venta alcanzables desde el pie | PASA en los 4 |
| Lo no configurado no se inventa (sin teléfono ni dirección) | PASA en los 4 |

Y una comprobación transversal: los cuatro producen **cuatro huellas distintas**
en la frontera visual y **una sola estructura** de documento. Distinta cara,
mismas capacidades.

## Lo que estas pruebas NO afirman

Que cada tema sea bonito para su rubro. Eso es una opinión de diseño y no se
puede demostrar con una aserción. Lo que sí queda demostrado es que ninguno de
los cuatro **pierde una capacidad comercial** por el camino, que es lo que
convertiría un tema en una tienda peor en vez de en otra tienda.

## Auditoría anti-bifurcación

Se buscó explícitamente lo que rompería la tesis:

| Patrón buscado | Hallazgo |
|---|---|
| `StoreHomeRetail`, `StoreHomePremium` y similares | No existe ninguno |
| `if`/`switch` por rubro en código de producción | Ninguno |
| `if (theme === …)` dentro de lógica de negocio | Ninguno. Los temas viajan como datos y como CSS |
| Copia de lógica de precio, descuento o stock | Ninguna fuera de los propios tests |
| CSS de la vitrina que afecte al backoffice | Ninguno: **todas** las reglas de `storefront.css` cuelgan de `.sf-scope` |

Un hallazgo que se revisó y se conservó: `src/features/storefront/categoryIcon.tsx`
asocia iconos a nombres de categoría, y entre esos nombres hay `medicamento` y
`farmac`. **No es una rama por rubro**: reacciona al texto que el comercio
escribió en SU categoría, igual que el tinte de color, y no a un campo donde
alguien declare a qué se dedica. Ese campo no existe, y esa es la diferencia.

## Nota sobre la vista previa del backoffice

`StorefrontPreview` importa `storefront.css` para que la vista previa se vea con
las mismas reglas que la tienda. No afecta al backoffice: cada regla de esa hoja
está bajo `.sf-scope`, y esa clase solo existe dentro del marco de la vista
previa.
