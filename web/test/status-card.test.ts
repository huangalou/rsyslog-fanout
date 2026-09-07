import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import StatusCard from '../src/components/StatusCard.vue'

describe('StatusCard', () => {
  it('顯示標題與數值', () => {
    const w = mount(StatusCard, { props: { title: 'udp:514', value: 42 } })
    expect(w.find('.title').text()).toBe('udp:514')
    expect(w.find('.value').text()).toBe('42')
  })

  it('未指定 state 時為 neutral', () => {
    const w = mount(StatusCard, { props: { title: 't', value: 'v' } })
    expect(w.classes()).toContain('state-neutral')
  })

  it.each(['ok', 'warn', 'danger'] as const)('state=%s 對應 state-%s class', (state) => {
    const w = mount(StatusCard, { props: { title: 't', value: 'v', state } })
    expect(w.classes()).toContain(`state-${state}`)
  })
})
