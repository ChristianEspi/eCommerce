/**
 * Productos de Quimica Suiza que son EL MISMO producto en distintas
 * concentraciones, tamanos, sabores, tonos o formatos, y que el ERP trae como
 * fichas sueltas. En la tienda pasan a ser un producto con variantes.
 *
 * Curado a mano a partir del catalogo real (2026-11-13), no por heuristica:
 * agrupar por nombre parecido juntaba Similac etapa 1 con etapa 3, y dejaba
 * duplicados del ERP («Iltux Hct 40» y «Iltux Hct 40 mg», el mismo producto
 * dos veces) como si fueran dos variantes. Los duplicados se quedan fuera.
 *
 * Cada miembro se identifica por su SKU (`QS-…`) o por su nombre exacto
 * (comparado sin tildes ni espacios dobles). `ejes` son codigos de atributo de
 * la sociedad marcados como eje de variante.
 */

const C = 'concentracion'
const P = 'presentacion'
const S = 'sabor'
const T = 'tono'
const F = 'formato'

/** Medicamentos: [sku padre, nombre, ejes, [[sku, valores…]]]. */
const MED = [
  ['CONSIV', 'Consiv Tableta Recubierta Caja 30 un', [C], [['282484', '18 mg'], ['282485', '27 mg'], ['568008', '36 mg'], ['282486', '54 mg']]],
  ['BRIVAXON', 'Brivaxon Tableta Recubierta Caja 30 un', [C], [['567924', '25 mg'], ['282472', '50 mg'], ['568007', '100 mg']]],
  ['TOPICTAL', 'Topictal Comprimidos Recubiertos Caja 28 un', [C], [['165601', '25 mg'], ['165602', '50 mg'], ['165603', '100 mg']]],
  ['PREBICTAL', 'Prebictal Cápsula Caja 14 un', [C], [['269235', '50 mg'], ['177518', '75 mg'], ['177519', '150 mg']]],
  ['QUETIAZIC', 'Quetiazic Tableta Caja 30 un', [C], [['505854', '25 mg'], ['503800', '100 mg'], ['503799', '200 mg'], ['586967', '300 mg']]],
  ['QUETIAZIC-XR', 'Quetiazic XR Cápsula de Liberación Prolongada Caja 30 un', [C], [['566767', '50 mg'], ['566768', '200 mg'], ['566769', '300 mg']]],
  ['NABILA', 'Nabila Tableta Caja 28 un', [C], [['505836', '2.5 mg'], ['505837', '5 mg'], ['505835', '10 mg']]],
  ['LACOTEM', 'Lacotem Comprimidos Recubiertos Caja 28 un', [C], [['564125', '50 mg'], ['564126', '100 mg'], ['564173', '200 mg']]],
  ['ISTARIL', 'Istaril Cápsulas de Liberación Prolongada Caja 30 un', [C], [['565913', '3.75 mg / 23 mg'], ['565912', '7.5 mg / 46 mg'], ['565911', '15 mg / 92 mg']]],
  ['PRAZINAL', 'Prazinal Cápsula Caja 30 un', [C], [['300852', '1.5 mg'], ['300853', '3 mg'], ['301020', '6 mg']]],
  ['PRECORTEN', 'Precorten Comprimido Caja 50 un', [C], [['678185', '5 mg'], ['678186', '20 mg'], ['678187', '50 mg']]],
  ['MICROSER', 'Microser Tableta', [C, P], [['134205', '8 mg', 'Caja x 50'], ['162173', '16 mg', 'Caja x 40'], ['579442', '24 mg', 'Caja x 20']]],
  ['DIMEFOR', 'Dimefor Tableta', [C, P], [['139748', '500 mg', 'Caja x 50'], ['133603', '850 mg', 'Caja x 30'], ['139751', '1000 mg', 'Caja x 30']]],
  ['RETEVEN', 'Reteven Tableta', [C, P], [['123603', '5 mg', 'Caja x 30'], ['123602', '5 mg', 'Caja x 60'], ['123564', '10 mg', 'Caja x 10']]],
  ['ILTUX', 'Iltux Comprimidos Recubiertos Caja 28 un', [C], [['505129', '20 mg'], ['505130', '40 mg']]],
  ['ILTUX-HCT', 'Iltux HCT Comprimidos Recubiertos Caja 28 un', [C], [['185302', '20 mg / 12.5 mg'], ['185303', '40 mg / 12.5 mg']]],
  ['ILTUXAM', 'Iltuxam Comprimidos Recubiertos Caja 28 un', [C], [['587569', '20 mg / 5 mg'], ['587571', '40 mg / 5 mg']]],
  ['ILTUXAM-HCT', 'Iltuxam HCT Comprimidos Recubiertos Caja 28 un', [C], [['292971', '40 mg / 5 mg / 12.5 mg'], ['292456', '40 mg / 10 mg / 25 mg']]],
  ['LURAZIC', 'Lurazic Comprimidos Caja 30 un', [C], [['287454', '20 mg'], ['287331', '40 mg'], ['287271', '80 mg']]],
  ['LUDOXA', 'Ludoxa Cápsula Caja 30 un', [C], [['301934', '30 mg'], ['301935', '50 mg'], ['301936', '70 mg']]],
  ['EMADIAN', 'Emadian Comprimidos Recubiertos Caja 30 un', [C], [['299926', '10 mg'], ['299927', '25 mg']]],
  ['EMADIAN-MET', 'Emadian Met Comprimidos Recubiertos Caja 60 un', [C], [['299955', '12.5 mg / 850 mg'], ['299954', '12.5 mg / 1000 mg']]],
  ['RUMADA', 'Rumada Comprimidos Caja 30 un', [C], [['298796', '5 mg / 10 mg'], ['298926', '10 mg / 10 mg'], ['298955', '20 mg / 10 mg']]],
  ['COLMIBE', 'Colmibe Comprimidos Caja 30 un', [C], [['299676', '10 mg / 10 mg'], ['299660', '20 mg / 10 mg'], ['298396', '40 mg / 10 mg']]],
  ['TEROVAN', 'Terovan Comprimidos Recubiertos', [C, P], [['828370', '24 mg / 26 mg', 'Caja x 30'], ['828367', '49 mg / 51 mg', 'Caja x 60'], ['828368', '97 mg / 103 mg', 'Caja x 60']]],
  ['PAXELIS', 'Paxelis Comprimidos Recubiertos Caja 10 un', [C], [['562411', '50 mg'], ['562412', '100 mg']]],
  ['PAXELIS-RETARD', 'Paxelis Retard Comprimidos de Liberación Prolongada', [C, P], [['562413', '50 mg', 'Caja x 10'], ['831842', '50 mg', 'Caja x 30'], ['562414', '100 mg', 'Caja x 10'], ['831843', '100 mg', 'Caja x 30']]],
  ['EUTEBROL', 'Eutebrol Tableta Caja 30 un', [C], [['156202', '10 mg'], ['218255', '20 mg']]],
  ['APITENA', 'Apitena Comprimidos Recubiertos Caja 30 un', [C], [['293233', '2.5 mg'], ['293232', '5 mg']]],
  ['ALCLIMAX', 'Alclimax Comprimido Recubierto Caja 10 un', [C], [['662877', '50 mg'], ['662876', '100 mg']]],
  ['CLAUTER', 'Clauter Comprimidos Caja 30 un', [C], [['218237', '50 mg'], ['218238', '100 mg']]],
  ['PARMITAL', 'Parmital Tableta Caja 30 un', [C], [['505561', '0.25 mg'], ['505562', '1 mg']]],
  ['FAPRIS', 'Fapris Cápsula de Liberación Prolongada Caja 30 un', [C], [['587490', '50 mg'], ['587491', '100 mg']]],
  ['DEXILANT', 'Dexilant Cápsulas de Liberación Retardada Caja 14 un', [C], [['286792', '30 mg'], ['286793', '60 mg']]],
  ['NIVELAN', 'Nivelan Comprimidos Recubiertos Caja 20 un', [C], [['135223', '1 mg'], ['135228', '2 mg']]],
  ['GESLUTIN', 'Geslutin Cápsula Blanda', [C, P], [['123583', '100 mg', 'Caja x 20'], ['154695', '200 mg', 'Caja x 10']]],
  ['NOLOTEN', 'Noloten Comprimidos', [C, P], [['123599', '5 mg', 'Caja x 20'], ['123594', '10 mg', 'Caja x 10']]],
  ['REFLUCIL', 'Reflucil Tableta Caja 30 un', [C], [['123458', '2.5 mg'], ['123459', '5 mg']]],
  ['NOVACILINA', 'Novacilina Comprimidos Recubiertos', [C, P], [['123574', '500 mg', 'Caja x 7'], ['168734', '750 mg', 'Caja x 5']]],
  ['NORSPAN', 'Norspan Parches Transdérmicos Caja 2 un', [C], [['258494', '5 µg/h'], ['258495', '10 µg/h']]],
  ['FLODIN', 'Flodin 15 mg Tableta', [P], [['123557', 'Caja x 30'], ['504314', 'Caja x 100']]],
  ['SUPRACALM', 'Supracalm 1 g Tableta', [P], [['123577', 'Caja x 10'], ['504477', 'Caja x 100']]],
  ['SUPRACALM-DUO', 'Supracalm Duo 37.5 mg / 325 mg Tableta', [P], [['163608', 'Caja x 10'], ['504326', 'Caja x 60']]],
  ['MUTUM', 'Mutum 150 mg Cápsula', [P], [['123591', 'Caja x 2'], ['123593', 'Caja x 4']]],
  ['FLUCOXIN', 'Flucoxin 150 mg Cápsula', [P], [['662880', 'Caja x 2'], ['663911', 'Caja x 4'], ['678337', 'Caja x 50']]],
  ['CORRILAX', 'Corrilax 17 g Polvo para Solución Oral', [P], [['505677', 'Caja x 15 sobres'], ['505678', 'Caja x 50 sobres']]],
  ['CABERTRIX', 'Cabertrix 0.5 mg Comprimido', [P], [['504905', 'Caja x 2'], ['504904', 'Caja x 8']]],
  ['MIRTAPAX', 'Mirtapax 30 mg Comprimidos Recubiertos', [P], [['123985', 'Caja x 10'], ['124075', 'Caja x 30']]],
  ['DOMINIUM-INY', 'Dominium 50 mg Solución Inyectable', [P], [['153459', 'Caja x 10'], ['504225', 'Caja x 30']]],
  ['FANTER', 'Fanter 10 mg Comprimidos Recubiertos', [P], [['295212', 'Caja x 15'], ['295211', 'Caja x 30']]],
  ['NALTREVA', 'Naltreva 8 mg / 90 mg Comprimidos de Liberación Prolongada', [P], [['284249', 'Caja x 60'], ['284279', 'Caja x 120']]],
  ['BISMUCID-SUSP', 'Bismucid Nueva Fórmula 262 mg/15 ml Suspensión Oral', [P], [['683425', 'Frasco 150 ml'], ['683424', 'Frasco 350 ml']]],
  ['COLUQUIM-SUSP', 'Coluquim 100 mg/5 ml Polvo para Suspensión Oral', [P], [['640088', 'Frasco 30 ml'], ['640087', 'Frasco 60 ml']]],
  ['NISTAGLOS', 'Nistaglos Ungüento', [P], [['290113', 'Tubo 15 g'], ['290112', 'Tubo 30 g']]],
]

/** Cuidado personal y nutricion: los miembros por nombre exacto. */
const RESTO = [
  ['HIPOGLOS-C', "Emulsión Protectora D'hipoglos C", [P], [["Emulsion Protectora D´hipoglos C 20 gr", 'Tubo 20 g'], ["Emulsion Protectora D´hipoglos C 35 gr", 'Tubo 35 g'], ["Emulsion Protectora D´hipoglos C 60 gr", 'Tubo 60 g'], ["Emulsion Protectora D´hipoglos C 120 gr", 'Pote 120 g']]],
  ['HIPOGLOS-Z', "Emulsión Protectora D'hipoglos Z", [P], [["Emulsion Protectora D'hipoglos Z 20 gr", 'Tubo 20 g'], ["Emulsion Protectora D'hipoglos Z 35 gr", 'Tubo 35 g'], ["Emulsion Protectora D'hipoglos Z 60 gr", 'Tubo 60 g'], ['Hipoglos Z Emulsion 120 gr', 'Pote 120 g']]],
  ['NIVEA-CREMA-LATA', 'Crema Humectante Nivea Lata', [P], [['Crema Humectante Nivea Lata 30 ml 1 un', '30 ml'], ['Crema Humectante Nivea Lata 60 ml 1 un', '60 ml'], ['Crema Humectante Nivea Lata 150 ml 1 un', '150 ml'], ['Crema Hidratante Nivea Lata 400 ml', '400 ml']]],
  ['NIVEA-EXPRESS', 'Crema Hidratante Nivea Express Piel Normal a Seca', [P], [['Crema Hidratante Nivea Express Piel Normal A Seca 250 ml', '250 ml'], ['Crema Hidratante Nivea Express Piel Normal A Seca 400 ml', '400 ml']]],
  ['NIVEA-SOFT-CORPORAL', 'Crema Corporal Nivea Soft Piel Seca', [P], [['Crema Corporal Nivea Soft Piel Seca 125 ml', '125 ml'], ['Crema Corporal Nivea Soft Piel Seca 250 ml', '250 ml']]],
  ['NIVEA-ANTIARRUGAS', 'Crema Facial Nivea Antiarrugas', [P], [['Crema Facial Nivea Antiarrugas 50 ml 1 un', '50 ml'], ['Crema Facial Nivea Antiarrugas 100 ml 1 un', '100 ml']]],
  ['NIVEA-NUTRITIVA', 'Crema Facial Nivea Nutritiva', [P], [['Crema Nivea Cuidado Nutritiva 50ml', '50 ml'], ['Crema Facial Nivea Nutritiva 100 ml 1 un', '100 ml']]],
  ...['Twisted', 'Dark Oil', 'Penetraitt', 'Hydre', 'Trilliance'].flatMap((linea) => [
    [`SEB-SHAMPOO-${linea.toUpperCase().replace(' ', '-')}`, `Shampoo Sebastian ${linea}`, [P], [[`Shampoo Sebastian ${linea} 250 ml`, '250 ml'], [`Shampoo Sebastian ${linea} 1l`, '1 L']]],
    [`SEB-ACOND-${linea.toUpperCase().replace(' ', '-')}`, `Acondicionador Sebastian ${linea}`, [P], [[`Acondicionador Sebastian ${linea} 250ml`, '250 ml'], [`Acondicionador Sebastian ${linea} 1l`, '1 L']]],
  ]),
  ...['Twisted', 'Dark Oil', 'Penetraitt'].map((linea) => [
    `SEB-MASCARILLA-${linea.toUpperCase().replace(' ', '-')}`, `Mascarilla Sebastian ${linea}`, [P], [[`Mascarilla Sebastian ${linea} 150 ml`, '150 ml'], [`Mascarilla Sebastian ${linea} 500 ml`, '500 ml']],
  ]),
  ['SEB-POTION-9', 'Tratamiento Sebastian Potion 9', [P], [['Tratamiento Sebastian Potion 9 150ml', '150 ml'], ['Tratamiento Sebastian Potion 9 500ml', '500 ml']]],
  ['SEBMAN-SHAMPOO', 'Shampoo Sebman Multitasker 3 en 1', [P], [['Shampoo Sebman Multitasker Sachet 3en1 15ml', 'Sachet 15 ml'], ['Shampoo Sebman Multitasker 3 En 1 250 ml', '250 ml'], ['Shampoo Sebman Multitasker 3 En 1 1l', '1 L']]],
  ['SEBMAN-ACOND', 'Acondicionador Sebman', [P], [['Acondicionador Sebman 250 ml', '250 ml'], ['Acondicionador Sebman 1 L', '1 L']]],
  ['SEB-CELLOPHANES', 'Sebastian Cellophanes Brillo con Color 300 ml', [T], [
    ['Sebastian Cellophanes Shine Clear 300ml', 'Shine Clear (transparente)'],
    ['Sebastian Cellophanes Ice Blond 300ml', 'Ice Blond'],
    ['Sebastian Cellophanes Vanilla Blond 300ml', 'Vanilla Blond'],
    ['Sebastian Cellophanes Honey Comb Blond 300ml', 'Honey Comb Blond'],
    ['Sebastian Cellophanes Caramel Brown 300ml', 'Caramel Brown'],
    ['Sebastian Cellophanes Chocolate Brown 300ml', 'Chocolate Brown'],
    ['Sebastian Cellophanes Espresso Brown 300ml', 'Espresso Brown'],
    ['Sebastian Cellophanes Cranberry Red 300 ml', 'Cranberry Red'],
  ]],
  // Desodorantes: la misma linea en roll on y en spray
  ['NIVEA-DEO-BW-CLEAR', 'Desodorante Nivea Invisible Black & White Clear', [F], [['Desodorante Roll On Nivea Invisible Black & White Antitranspirante Clear 50 ml', 'Roll on 50 ml'], ['Desodorante Spray Nivea Invisible Black & White Antibacterial Clear 150 ml', 'Spray 150 ml']]],
  ['NIVEA-DEO-CLARITY', 'Desodorante Nivea Aclarado Natural Clarity Touch', [F], [['Desodorante Roll On Nivea Aclarado Natural Antitranspirante Femenino Clarity Touch 50 ml', 'Roll on 50 ml'], ['Desodorante Spray Nivea Aclarado Natural Antitranspirante Clarity Touch 150 ml', 'Spray 150 ml']]],
  ['NIVEA-DEO-PEARL', 'Desodorante Nivea Pearl & Beauty Femenino', [F], [['Desodorante Roll On Nivea Pearl & Beauty Femenino 50 ml', 'Roll on 50 ml'], ['Desodorante Spray Nivea Pearl & Beauty Femenino 150 ml', 'Spray 150 ml']]],
  ['NIVEA-DEO-STRESS-FEM', 'Desodorante Nivea Stress Protect Femenino', [F], [['Desodorante Nivea Stress Protect Fem Roll On 50 ml', 'Roll on 50 ml'], ['Desodorante Spray Nivea Stress Protect Femenino 150 ml', 'Spray 150 ml']]],
  ['NIVEA-DEO-DEEP-BLACK', 'Desodorante Nivea Men Deep Black Carbón', [F], [['Desodorante Roll On Nivea Men Deep Black Carbón 50 ml', 'Roll on 50 ml'], ['Desodorante Spray Nivea Men Deep Black Carbón 150 ml', 'Spray 150 ml']]],
  ['NIVEA-DEO-PROTECT-CARE', 'Desodorante Nivea Men Protect & Care', [F], [['Desodorante Nivea Men Roll On Protect & Care 50 ml', 'Roll on 50 ml'], ['Desodorante Nivea Men Aerosol Protect & Care 150 ml', 'Spray 150 ml']]],
  ['NIVEA-DEO-BEAUTY-TOUCH', 'Desodorante Nivea Aclarado Natural Beauty Touch', [F], [['Desodorante Roll On Nivea Acl Natural Beauty Touch 50 ml', 'Roll on 50 ml'], ['Desodorante Spray Nivea Acl Natural Beauty Touch 150 ml', 'Spray 150 ml']]],
  ['NIVEA-DEO-SERUM', 'Desodorante Nivea Extra Aclarado Serum', [F], [['Desodorante Roll On Nivea Serum Extraclaro 40 ml', 'Roll on 40 ml'], ['Desodorante En Aerosol Nivea Extra Aclarado Serum 100 ml', 'Spray 100 ml']]],
  // Nutricion
  ['PEDIASURE-TRIPLESURE', 'Suplemento Nutricional Pediasure Triplesure en Polvo', [S, P], [
    ['Suplemento Nutricional Pediasure Triplesure En Polvo Sabor Vainilla 400 gr', 'Vainilla', 'Lata 400 g'],
    ['Suplemento Nutricional Pediasure Triplesure En Polvo Sabor Vainilla Lata 900 gr', 'Vainilla', 'Lata 900 g'],
    ['Suplemento Nutricional Pediasure Triplesure En Polvo Sabor Vainilla Lata 1.6 Kg', 'Vainilla', 'Lata 1.6 kg'],
    ['Suplemento Nutricional Pediasure Triplesure En Polvo Sabor Chocolate 400 gr', 'Chocolate', 'Lata 400 g'],
    ['Suplemento Nutricional Pediasure Triplesure En Polvo Sabor Chocolate 900 gr', 'Chocolate', 'Lata 900 g'],
    ['Suplemento Nutricional Pediasure En Polvo Sabor Chocolate Lata 1.6 Kg', 'Chocolate', 'Lata 1.6 kg'],
  ]],
  ['PEDIASURE-PEPTI-GRO', 'Fórmula Infantil Pediasure Pepti Gro', [S, P], [
    ['Fórmula Infantil Pediasure Pepti Gro Vainilla 400 gr', 'Vainilla', 'Lata 400 g'],
    ['Fórmula Infantil Pediasure Pepti Gro Vainilla 850 gr', 'Vainilla', 'Lata 850 g'],
    ['Fórmula Infantil Pediasure Pepti Gro Vainilla 1.6 Kg', 'Vainilla', 'Lata 1.6 kg'],
    ['Pediasure Pepti Gro Liq Vaini Fco 220ml', 'Vainilla', 'Líquido 220 ml'],
    ['Fórmula Infantil Pediasure Pepti Gro Chocolate 400 gr', 'Chocolate', 'Lata 400 g'],
    ['Fórmula Infantil Pediasure Pepti Gro Chocolate 850 gr', 'Chocolate', 'Lata 850 g'],
    ['Fórmula Infantil Pediasure Pepti Gro Chocolate 1.6 Kg', 'Chocolate', 'Lata 1.6 kg'],
    ['Pediasure Pepti Gro Liq Choco Fco 220ml', 'Chocolate', 'Líquido 220 ml'],
  ]],
  ['ENSURE-ADVANCE', 'Suplemento Nutricional Ensure Advance', [S, P], [
    ['Suplemento Nutricional Ensure Advance Vainilla 400 gr', 'Vainilla', 'Lata 400 g'],
    ['Suplemento Nutricional Ensure Advance 850 gr', 'Vainilla', 'Lata 850 g'],
    ['Suplemento Nutricional Ensure Advance Vainilla 220 ml', 'Vainilla', 'Líquido 220 ml'],
    ['Suplemento Nutricional Ensure Advance Polvo Vainilla Sachet 53.5 G', 'Vainilla', 'Sachet 53.5 g'],
    ['Ensure Advance Vain 10 Sachets 53.5 gr', 'Vainilla', 'Caja x 10 sachets'],
    ['Suplemento Nutricional Ensure Advance Chocolate 400 gr', 'Chocolate', 'Lata 400 g'],
    ['Suplemento Nutricional Ensure Advance Chocolate 850 gr', 'Chocolate', 'Lata 850 g'],
    ['Ensure Advance Chocolate Fco 220 ml', 'Chocolate', 'Líquido 220 ml'],
  ]],
  ['GLUCERNA-POLVO', 'Suplemento Nutricional Glucerna en Polvo', [S, P], [
    ['Suplemento Nutricional Glucerna Vainilla Polvo Lata 400 gr', 'Vainilla', 'Lata 400 g'],
    ['Suplemento Nutricional Glucerna Vainilla Polvo Lata 850 gr', 'Vainilla', 'Lata 850 g'],
    ['Glucerna Cappuccino Pvo Lta 400gr', 'Cappuccino', 'Lata 400 g'],
  ]],
  ['SIMILAC-1-HMO', 'Fórmula Infantil Similac 1 HMO', [P], [['Suplemento Nutricional Similac 1 Hmo Polvo Lata 350 gr', 'Lata 350 g'], ['Formula Lactea Similac 1 Etapa 1 En Polvo Lata 800 gr', 'Lata 800 g'], ['Similac 1 Hmo Pvo Lta 1800 gr', 'Lata 1.8 kg']]],
  ['SIMILAC-2-HMO', 'Fórmula Infantil Similac 2 HMO', [P], [['Suplemento Nutricional Similac 2 Hmo Polvo Lata 800 gr', 'Lata 800 g'], ['Suplemento Nutricional Similac 2 Hmo Polvo Lata 1800 gr', 'Lata 1.8 kg']]],
  ['SIMILAC-3-HMO', 'Leche de Crecimiento Similac 3 HMO', [P], [['Suplemento Nutricional Similac 3 Hmo Polvo Lata 350 gr', 'Lata 350 g'], ['Formula Lactea Similac 3 Hmo En Polvo Lata 800 gr', 'Lata 800 g'], ['Suplemento Nutricional Similac 3 Hmo Polvo Caja 2.1 Kg', 'Caja 2.1 kg']]],
  ['SIMILAC-2-NP', 'Fórmula Infantil Similac 2 NP HMO', [P], [['Similac 2 Np Hmo Pvo Lta 350gr', 'Lata 350 g'], ['Similac 2 Np Hmo Pvo Lta 800 gr', 'Lata 800 g']]],
  ['SIMILAC-3-NP', 'Leche de Crecimiento Similac 3 NP HMO', [P], [['Similac 3 Np Hmo Pvo Lta 350gr', 'Lata 350 g'], ['Similac 3 Np Hmo Pvo Lta x 800gr', 'Lata 800 g']]],
  ['SIMILAC-TC-PROSENSITIVE', 'Fórmula Infantil Similac Total Comfort Prosensitive 1 (0-12 meses)', [P], [['Fórmula Infantil Similac Total Comfort Prosensitive 1 (0-12 Meses) Lata 360 gr', 'Lata 360 g'], ['Fórmula Infantil Similac Total Comfort Prosensitive 1 (0-12 Meses) Lata 820 gr', 'Lata 820 g'], ['Fórmula Infantil Similac Total Comfort Prosensitive 1.4 Kg', 'Caja 1.4 kg']]],
  ['SIMILAC-TC-1', 'Fórmula Infantil Similac Total Comfort 1 (0-12 meses)', [P], [['Similac Total Comfort1 Pv 0-12m Lta 350g', 'Lata 350 g'], ['Similac Total Comfort1 Pv 0-12m Lta 800g', 'Lata 800 g'], ['Similac Total Comfort1 Pv 0-12m Cj 1.4kg', 'Caja 1.4 kg']]],
  ['SIMILAC-TC-KID', 'Leche de Crecimiento Similac Total Comfort Kid', [P], [['Suplemento Nutricional Similac Total Comfort Kid Lata 820 gr', 'Lata 820 g'], ['Suplemento Nutricional Similac Total Comfort Kid 1.4 Kg', 'Caja 1.4 kg']]],
  ['PEDIASURE-SACHET', 'Pediasure Vainilla Sachet 48.6 g', [P], [['Pediasure Vainilla 10 Sachet 48.6g', 'Caja x 10'], ['Pediasure Vainilla 48.6g Sachet x 100', 'Caja x 100']]],
  ['PEDIASURE-10', 'Suplemento Alimentario Pediasure 10+ Vainilla (10 a 15 años)', [P], [['Suplemento Alimentario Pediasure 10+ Vainilla 10 A 15 Años 220 ml', 'Líquido 220 ml'], ['Suplemento Alimentario Pediasure 10+ Vainilla 10 A 15 Años 850 gr', 'Lata 850 g']]],
  ['PEDIALYTE-30', 'Bebida Rehidratante Pedialyte 30 mEq 500 ml', [S], [['Bebida Con Electrolitos Pedialyte 30 Meq Sabor Cereza 500 ml', 'Cereza'], ['Bebida Rehidratante Pedialyte 30 Ng Manzana 500 ml', 'Manzana']]],
  ['PEDIALYTE-MAX-60', 'Bebida Rehidratante Pedialyte Max 60 mEq 500 ml', [S], [['Bebida Con Electrolitos Pedialyte Max 60 Meq Sabor Uva 500 ml', 'Uva'], ['Bebida Rehidratante Pedialyte Max 60 Ng Manzana 500 ml', 'Manzana'], ['Bebida Con Electrolitos Pedialyte Max 60 Ng Fresa 500 ml', 'Fresa']]],
]

/** Todos los grupos, normalizados: { sku, nombre, ejes, miembros: [{ ref, valores: {eje: valor} }] }. */
export const GRUPOS = [...MED.map(([s, n, e, m]) => [s, n, e, m.map(([sku, ...v]) => [`QS-${sku}`, ...v])]), ...RESTO].map(
  ([sku, nombre, ejes, miembros]) => ({
    sku: `QSV-${sku}`,
    nombre,
    ejes,
    miembros: miembros.map(([ref, ...valores]) => ({
      ref,
      valores: Object.fromEntries(ejes.map((eje, i) => [eje, valores[i]])),
    })),
  }),
)

/** Ejes de variante que usan los grupos, con su nombre visible. */
export const EJES = [
  { code: C, name: 'Concentración' },
  { code: P, name: 'Presentación' },
  { code: S, name: 'Sabor' },
  { code: T, name: 'Tono' },
  { code: F, name: 'Formato' },
]
