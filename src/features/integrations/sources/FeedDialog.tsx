import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
} from '@mui/material'
import { Field } from '@/shared/ui/Field'
import { useState } from 'react'
import { useWarehouses } from '@/features/inventory/hooks'
import { usePriceLists } from '@/features/pricing/hooks'
import { useTenant } from '@/features/tenant/tenant-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { useI18n } from '@/shared/i18n/i18n-context'
import { SelectField } from '@/shared/ui/SelectField'
import { IntegrationsError } from '../errors'
import { useSaveFeed } from './hooks'
import { feedDraftProblem } from './rules'
import { FEED_INTERVALS, FEED_RESOURCES, type ConnectorFeed, type FeedDraft, type FeedResource } from './types'

const DEFAULT_PATHS: Record<FeedResource, string> = {
  stock: '/ebim/v1/stock',
  prices: '/ebim/v1/prices',
}

export function FeedDialog({
  open,
  sourceId,
  feed,
  onClose,
}: {
  open: boolean
  sourceId: string
  feed: ConnectorFeed | null
  onClose: () => void
}) {
  const { t } = useI18n()
  const { activeStore } = useTenant()
  const save = useSaveFeed()
  const lists = usePriceLists(activeStore?.id ?? null)
  const warehouses = useWarehouses(open)
  const erpWarehouses = (warehouses.data ?? []).filter((w) => w.source === 'erp' && w.is_active)

  const [draft, setDraft] = useState<FeedDraft>(() => ({
    sourceId,
    resource: feed?.resource ?? 'stock',
    path: feed?.path ?? DEFAULT_PATHS.stock,
    intervalMinutes: feed?.interval_minutes ?? 60,
    pageSize: feed?.page_size ?? 200,
    priceListId: feed?.price_list_id ?? null,
    defaultWarehouseId: feed?.default_warehouse_id ?? null,
    isActive: feed?.is_active ?? true,
  }))
  const [touched, setTouched] = useState(false)
  const set = <K extends keyof FeedDraft>(key: K, value: FeedDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  const problem = feedDraftProblem(draft)

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t(feed ? 'integrations.sources.feed.editTitle' : 'integrations.sources.feed.newTitle')}</DialogTitle>
      <DialogContent>
        <Stack
          component="form"
          id="connector-feed-form"
          sx={{ gap: 2, pt: 1 }}
          onSubmit={(event) => {
            event.preventDefault()
            setTouched(true)
            if (problem) return
            save.mutate({ id: feed?.id ?? null, draft }, { onSuccess: onClose })
          }}
        >
          {save.isError && (
            <Alert severity="error">
              {t(save.error instanceof IntegrationsError ? save.error.key : 'integrations.error.generic')}
            </Alert>
          )}
          {touched && problem && <Alert severity="warning">{t(problem)}</Alert>}

          <SelectField
            label={t('integrations.sources.feed.resource')}
            value={draft.resource}
            disabled={Boolean(feed)}
            onChange={(event) => {
              const resource = event.target.value as FeedResource
              setDraft((current) => ({
                ...current,
                resource,
                path: current.path === DEFAULT_PATHS[current.resource] ? DEFAULT_PATHS[resource] : current.path,
              }))
            }}
            helperText={t(`integrations.sources.feed.resourceHelp.${draft.resource}` as MessageKey)}
          >
            {FEED_RESOURCES.map((resource) => (
              <MenuItem key={resource} value={resource}>
                {t(`integrations.sources.resource.${resource}` as MessageKey)}
              </MenuItem>
            ))}
          </SelectField>

          <Field
            rule="apiPath" help={t('integrations.sources.feed.pathHelp')}
            label={t('integrations.sources.feed.path')}
            value={draft.path}
            onChange={(event) => set('path', event.target.value.trim())}
            error={touched && problem === 'integrations.sources.validation.path'}
          />

          {draft.resource === 'prices' ? (
            <SelectField
              label={t('integrations.sources.feed.priceList')}
              value={draft.priceListId ?? ''}
              onChange={(event) => set('priceListId', event.target.value || null)}
              helperText={t('integrations.sources.feed.priceListHelp')}
              error={touched && !draft.priceListId}
            >
              {(lists.data ?? []).map((list) => (
                <MenuItem key={list.id} value={list.id}>
                  {list.name} · {list.currency}
                </MenuItem>
              ))}
            </SelectField>
          ) : (
            <>
              <SelectField
                label={t('integrations.sources.feed.warehouse')}
                value={draft.defaultWarehouseId ?? ''}
                onChange={(event) => set('defaultWarehouseId', event.target.value || null)}
                helperText={t('integrations.sources.feed.warehouseHelp')}
                SelectProps={{ displayEmpty: true }}
                slotProps={{ inputLabel: { shrink: true } }}
              >
                <MenuItem value="">{t('integrations.sources.feed.warehouseNone')}</MenuItem>
                {erpWarehouses.map((warehouse) => (
                  <MenuItem key={warehouse.id} value={warehouse.id}>
                    {warehouse.code} · {warehouse.name}
                  </MenuItem>
                ))}
              </SelectField>
              {warehouses.isSuccess && erpWarehouses.length === 0 && (
                <Alert severity="info">{t('integrations.sources.feed.noErpWarehouse')}</Alert>
              )}
            </>
          )}

          <SelectField
            label={t('integrations.sources.feed.interval')}
            value={draft.intervalMinutes}
            onChange={(event) => set('intervalMinutes', Number(event.target.value))}
          >
            {FEED_INTERVALS.map((minutes) => (
              <MenuItem key={minutes} value={minutes}>
                {minutes < 60
                  ? t('integrations.sources.every.minutes').replace('{n}', String(minutes))
                  : t('integrations.sources.every.hours').replace('{n}', String(minutes / 60))}
              </MenuItem>
            ))}
          </SelectField>

          <Field
            rule="integer" maxLength={4} help={t('help.integrations.sources.pageSize')}
            type="number"
            label={t('integrations.sources.feed.pageSize')}
            value={draft.pageSize}
            onChange={(event) => set('pageSize', Math.min(1000, Math.max(1, Number(event.target.value) || 200)))}
            slotProps={{ htmlInput: { min: 1, max: 1000 } }}
          />
          <FormControlLabel
            control={<Switch checked={draft.isActive} onChange={(event) => set('isActive', event.target.checked)} />}
            label={t('integrations.sources.field.active')}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={save.isPending}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" form="connector-feed-form" variant="contained" disabled={save.isPending}>
          {save.isPending ? t('common.saving') : t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
