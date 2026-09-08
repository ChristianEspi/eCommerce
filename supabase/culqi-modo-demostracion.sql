-- El medio de tarjeta dice que la pasarela no esta conectada.
--
-- El conector aprueba sin pedir tarjeta porque es un simulacro, y una pantalla
-- que cobra sin preguntar nada y luego dice «Pagado» esta afirmando algo que no
-- ocurrio. Delante de un cliente esa es la primera pregunta que sale, y la
-- respuesta tiene que estar ANTES de la pregunta.
update public.payment_methods m
set
  display_name = 'Tarjeta (pasarela en demostracion)',
  instructions =
    'La pasarela Culqi todavia no esta conectada: este cobro se simula y no se carga nada a ninguna tarjeta. '
    || 'Al conectarla, aqui se pedira el numero de tarjeta en el formulario seguro de Culqi.'
from public.stores s
where s.id = m.store_id
  and s.slug = 'miquimica'
  and m.code = 'tarjeta';

select m.code, m.display_name, m.is_active, left(m.instructions, 60) as instrucciones
from public.payment_methods m
join public.stores s on s.id = m.store_id
where s.slug = 'miquimica' and m.code = 'tarjeta';
