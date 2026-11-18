'use strict';
'require fs';
'require ui';
'require view';
'require poll';

// Port map: ethtool netdev name -> label shown in the UI.
// Only lan5 is confirmed on hardware; the others follow the PR 26334 DTS
// (ethphy0..3 -> pse_pi0..3) and must be checked.
var PORTS = [
	{ dev: 'lan5', label: 'LAN 5' },
	{ dev: 'lan4', label: 'LAN 4' },
	{ dev: 'lan3', label: 'LAN 3' },
	{ dev: 'lan2', label: 'LAN 2' }
];

var ETHTOOL = '/usr/sbin/ethtool';

// Parse the text output of `ethtool --show-pse <dev>`.
// Example lines:
//   Clause 33 PSE Admin State: enabled
//   Clause 33 PSE Power Detection Status: searching
//   Clause 33 PSE Available Power Limit: 30000
function parsePse(text) {
	var st = { admin: null, detect: null, limit: null, actual: null, ranges: [] };
	(text || '').split('\n').forEach(function (line) {
		var m;
		if ((m = line.match(/PSE Admin State:\s*(\S+)/)))
			st.admin = m[1];
		else if ((m = line.match(/PSE Power Detection Status:\s*(.+)$/)))
			st.detect = m[1].trim();
		else if ((m = line.match(/PSE Available Power Limit:\s*(\d+)/)))
			st.limit = parseInt(m[1], 10);
		else if ((m = line.match(/PSE Actual Power:\s*(\d+)/)))
			st.actual = parseInt(m[1], 10);
		else if ((m = line.match(/max\s+(\d+)/)))
			st.ranges.push(parseInt(m[1], 10));
	});
	return st;
}

function readPort(dev) {
	return L.resolveDefault(fs.exec_direct(ETHTOOL, ['--show-pse', dev]), '')
		.then(function (out) {
			return parsePse(out);
		})
		.catch(function () {
			return null;
		});
}

function setAdmin(dev, enable) {
	return fs.exec_direct(ETHTOOL, [
		'--set-pse', dev,
		'c33-pse-admin-control', enable ? 'enable' : 'disable'
	]);
}

function setLimit(dev, mw) {
	return fs.exec_direct(ETHTOOL, [
		'--set-pse', dev,
		'c33-pse-avail-pw-limit', String(mw)
	]);
}

function detectLabel(s) {
	switch (s) {
	case 'searching': return _('Searching (no device)');
	case 'deliveringPower': return _('Delivering power');
	case 'disabled': return _('Disabled');
	case 'fault': return _('Fault');
	default: return s || '-';
	}
}

return view.extend({
	load: function () {
		return Promise.all(PORTS.map(function (p) {
			return readPort(p.dev);
		}));
	},

	handleStatus: function (dev, enable, ev) {
		ui.showModal(null, [E('p', { 'class': 'spinning' }, _('Applying...'))]);
		return setAdmin(dev, enable)
			.then(function () {
				ui.hideModal();
				return this.refresh();
			}.bind(this))
			.catch(function (err) {
				ui.hideModal();
				ui.addNotification(null, E('p', _('Failed: %s').format(err.message || err)), 'error');
			});
	},

	handleLimit: function (dev, ev) {
		var input = ev.target.closest('tr').querySelector('input');
		var mw = parseInt(input.value, 10);
		if (!(mw > 0)) {
			ui.addNotification(null, E('p', _('Enter a power limit in mW')), 'error');
			return;
		}
		return setLimit(dev, mw)
			.then(function () {
				return this.refresh();
			}.bind(this))
			.catch(function (err) {
				ui.addNotification(null, E('p', _('Failed: %s').format(err.message || err)), 'error');
			});
	},

	refresh: function () {
		return Promise.all(PORTS.map(function (p) {
			return readPort(p.dev);
		})).then(function (states) {
			this.states = states;
			this.renderTable();
		}.bind(this));
	},

	renderTable: function () {
		var rows = PORTS.map(function (p, i) {
			var s = this.states[i];
			if (!s)
				return E('tr', {}, [
					E('td', {}, p.label), E('td', { colspan: 4 }, _('ethtool PSE not available'))
				]);

			var enabled = s.admin === 'enabled';
			var toggle = E('button', {
				'class': 'cbi-button cbi-button-' + (enabled ? 'negative' : 'positive'),
				'click': ui.createHandlerFn(this, 'handleStatus', p.dev, !enabled)
			}, enabled ? _('Disable') : _('Enable'));

			var limitInput = E('input', {
				'type': 'number', 'min': 1, 'step': 100,
				'value': s.limit || '', 'style': 'width: 8em'
			});
			var limitBtn = E('button', {
				'class': 'cbi-button cbi-button-action',
				'click': ui.createHandlerFn(this, 'handleLimit', p.dev)
			}, _('Set limit (mW)'));

			return E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, p.label + ' (' + p.dev + ')'),
				E('td', { 'class': 'td' }, enabled ? _('Enabled') : _('Disabled')),
				E('td', { 'class': 'td' }, detectLabel(s.detect)),
				E('td', { 'class': 'td' }, s.actual != null ? (s.actual / 1000).toFixed(2) + ' W' : '-'),
				E('td', { 'class': 'td' }, s.limit ? (s.limit / 1000).toFixed(1) + ' W' : '-'),
				E('td', { 'class': 'td' }, [toggle, ' ', limitInput, ' ', limitBtn])
			]);
		}, this);

		var table = E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('Port')),
				E('th', { 'class': 'th' }, _('Admin state')),
				E('th', { 'class': 'th' }, _('Detection')),
				E('th', { 'class': 'th' }, _('Power draw')),
				E('th', { 'class': 'th' }, _('Power limit')),
				E('th', { 'class': 'th' }, _('Control'))
			])
		].concat(rows));

		var total = 0, measured = 0;
		this.states.forEach(function (s) {
			if (s && s.actual != null) {
				total += s.actual;
				measured++;
			}
		});
		var summary = E('p', { 'style': 'margin-top: 1em' },
			_('Total draw: %s').format(measured ? (total / 1000).toFixed(2) + ' W' : '-') +
			(measured && measured < this.states.length
				? ' ' + _('(%d of %d ports reporting)').format(measured, this.states.length)
				: ''));

		this.box.innerHTML = '';
		this.box.appendChild(table);
		this.box.appendChild(summary);
	},

	render: function (states) {
		this.states = states;
		this.box = E('div', {});
		var root = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('PoE Manager')),
			E('div', { 'class': 'cbi-map-descr' },
				_('Power over Ethernet state from the IC Plus IP804AR PSE (kernel driver, ethtool netlink).')),
			this.box
		]);
		this.renderTable();
		poll.add(this.refresh.bind(this), 15);
		return root;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
