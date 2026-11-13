/**
 * Kits de MiQuimica: los que se rehacen y los nuevos.
 *
 * Los componentes se nombran por el producto ORIGINAL (SKU o nombre exacto).
 * Si ese producto paso a ser variante de un grupo, el script apunta el
 * componente al padre y a esa variante: el kit no se entera.
 *
 * `descuento` es lo que el kit cuesta menos que comprar las piezas sueltas.
 */
export const KITS = [
  {
    sku: 'kit-0001',
    nombre: 'Kit Prevención e Higiene de Manos',
    marca: 'MiQuimica',
    descuento: 0.1,
    descripcion:
      'Lo necesario para la higiene de manos en casa, la oficina o el consultorio: dos frascos de alcohol en gel al 70 % con glicerina, jabón líquido para el lavado frecuente y una caja de mascarillas KN95 de cinco capas.',
    highlights: ['2 alcoholes en gel 70° de 500 ml', 'Jabón líquido para lavado de manos', 'Caja de 10 mascarillas KN95', 'Ahorra 10 % frente a comprar por separado'],
    componentes: [
      ['CPE-ALC-070', 2],
      ['QS-000006', 1],
      ['BOT-MAS-095', 1],
    ],
  },
  {
    sku: 'KIT-RIZOS-SEBASTIAN',
    nombre: 'Kit Rizos Definidos Sebastian Twisted',
    marca: 'Sebastian',
    descuento: 0.12,
    descripcion:
      'Rutina completa de la línea Twisted de Sebastian Professional para cabello rizado u ondulado: shampoo que lava sin resecar, acondicionador que desenreda y da elasticidad, y mascarilla de tratamiento semanal que define el rizo y controla el frizz.',
    highlights: ['Shampoo Twisted 250 ml', 'Acondicionador Twisted 250 ml', 'Mascarilla Twisted 150 ml', 'Para cabello rizado u ondulado'],
    componentes: [
      ['Shampoo Sebastian Twisted 250 ml', 1],
      ['Acondicionador Sebastian Twisted 250ml', 1],
      ['Mascarilla Sebastian Twisted 150 ml', 1],
    ],
  },
  {
    sku: 'KIT-REPARACION-SEBASTIAN',
    nombre: 'Kit Reparación Sebastian Penetraitt',
    marca: 'Sebastian',
    descuento: 0.12,
    descripcion:
      'Tratamiento reparador de la línea Penetraitt de Sebastian Professional para cabello dañado por químicos, decoloración o calor: shampoo, acondicionador y mascarilla que fortalecen la fibra y devuelven suavidad.',
    highlights: ['Shampoo Penetraitt 250 ml', 'Acondicionador Penetraitt 250 ml', 'Mascarilla Penetraitt 150 ml', 'Para cabello dañado o químicamente tratado'],
    componentes: [
      ['Shampoo Sebastian Penetraitt 250 ml', 1],
      ['Acondicionador Sebastian Penetraitt 250ml', 1],
      ['Mascarilla Sebastian Penetraitt 150 ml', 1],
    ],
  },
  {
    sku: 'KIT-CAMBIO-PANAL',
    nombre: "Kit Cambio de Pañal D'hipoglos y Eucerin Baby",
    marca: 'Grünenthal',
    descuento: 0.1,
    descripcion:
      "Para el cambio de pañal de todos los días: emulsión protectora D'hipoglos Z para cada cambio, D'hipoglos C para la piel ya irritada y gel de baño Eucerin Baby, sin perfume, para la piel sensible del bebé.",
    highlights: ["D'hipoglos Z 60 g para cada cambio", "D'hipoglos C 35 g para la piel irritada", 'Gel de baño Eucerin Baby 240 ml', 'Sin perfume, para piel sensible'],
    componentes: [
      ["Emulsion Protectora D'hipoglos Z 60 gr", 1],
      ['Emulsion Protectora D´hipoglos C 35 gr', 1],
      ['Gel de Baño Eucerin Baby Piel Sensible 240 ml 1 un', 1],
    ],
  },
  {
    sku: 'KIT-BOTIQUIN-HOGAR',
    nombre: 'Kit Botiquín Básico del Hogar',
    marca: 'MiQuimica',
    descuento: 0.08,
    descripcion:
      'Los básicos de venta libre para tener a mano en casa: paracetamol para el dolor y la fiebre, ibuprofeno antiinflamatorio, loratadina para la alergia, suero de rehidratación oral, alcohol en gel y curitas. Lee el prospecto de cada medicamento antes de usarlo.',
    highlights: ['Paracetamol, ibuprofeno y loratadina', 'Pedialyte 30 para rehidratación', 'Alcohol en gel y curitas', 'Solo productos de venta libre'],
    componentes: [
      [{ sku: 'MED-PAR-500', variante: 'MED-PAR-500-C20' }, 1],
      ['MED-IBU-400', 1],
      ['MED-LOR-010', 1],
      ['Bebida Rehidratante Pedialyte 30 Ng Manzana 500 ml', 1],
      ['CPE-ALC-070', 1],
      ['Curitas Transpiel 20 un', 1],
    ],
  },
  {
    sku: 'PACK-ENSURE-ADVANCE-3',
    nombre: 'Pack Ensure Advance Vainilla 400 g x 3',
    marca: 'Abbott',
    descuento: 0.1,
    descripcion:
      'Tres latas de Ensure Advance sabor vainilla de 400 g: nutrición completa con proteína y HMB para ayudar a mantener la masa y la fuerza muscular. Úsalo como complemento de una alimentación variada.',
    highlights: ['3 latas de 400 g', 'Sabor vainilla', 'Con proteína y HMB', 'Ahorra 10 % frente a 3 latas sueltas'],
    componentes: [['Suplemento Nutricional Ensure Advance Vainilla 400 gr', 3]],
  },
  {
    sku: 'KIT-ANTIEDAD-EUCERIN',
    nombre: 'Kit Antiedad Eucerin Hyaluron-Filler',
    marca: 'Beiersdorf',
    descuento: 0.12,
    descripcion:
      'Rutina antiedad completa de Eucerin Hyaluron-Filler con ácido hialurónico: crema de día con FPS 15, crema de noche y contorno de ojos, para rellenar arrugas y devolver firmeza a la piel madura.',
    highlights: ['Crema de día FPS 15 50 ml', 'Crema de noche 50 ml', 'Contorno de ojos 15 ml', 'Con ácido hialurónico'],
    componentes: [
      ['Crema de Dia Eucerin Hyaluron Filler Fps 15 50 ml', 1],
      ['Crema de Noche Eucerin Hyaluron Filler 50 ml', 1],
      ['Crema Contorno de Ojos Eucerin Hyaluron Filler 15 ml', 1],
    ],
  },
  {
    sku: 'KIT-ANTIMANCHAS-EUCERIN',
    nombre: 'Kit Antimanchas Eucerin Anti-Pigment',
    marca: 'Beiersdorf',
    descuento: 0.12,
    descripcion:
      'Rutina de Eucerin Anti-Pigment con Thiamidol para reducir las manchas oscuras y prevenir que vuelvan: sérum dual, crema de día con FPS 30 y crema de noche.',
    highlights: ['Sérum Dual 30 ml', 'Crema de día FPS 30 50 ml', 'Crema de noche 50 ml', 'Con Thiamidol'],
    componentes: [
      ['Serum Facial Eucerin Anti Pigmentación Dual 30 ml 1 un', 1],
      ['Crema Facial Día Eucerin Anti Pigmentación Spf30 50 ml 1 un', 1],
      ['Crema Facial Noche Eucerin Anti Pigmentación 50 ml 1un', 1],
    ],
  },
]
