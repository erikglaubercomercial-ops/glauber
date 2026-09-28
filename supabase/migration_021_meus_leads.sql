-- ============================================================
-- MIGRAÇÃO 021 — nova tela "Meus leads" (submenu de "Leads"),
-- mostrando só os leads do próprio usuário. Só ajusta a ordem do
-- menu (menu_config): insere "meusleads" como filho de "leads",
-- preservando qualquer reordenação que o ADM já tenha feito pelo
-- editor de menu. Idempotente — pode rodar mais de uma vez sem
-- duplicar o item.
-- ============================================================

update public.menu_config
set structure = jsonb_set(
  structure,
  '{sections}',
  (
    select jsonb_agg(
      jsonb_set(
        section,
        '{items}',
        (
          select jsonb_agg(
            case
              when item->>'id' = 'leads' and not (coalesce(item->'children', '[]'::jsonb) ? 'meusleads')
                then jsonb_set(item, '{children}', jsonb_build_array('meusleads') || coalesce(item->'children', '[]'::jsonb))
              else item
            end
          )
          from jsonb_array_elements(section->'items') as item
        )
      )
    )
    from jsonb_array_elements(structure->'sections') as section
  )
)
where id = 1;
