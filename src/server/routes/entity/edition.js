var express = require('express');
var router = express.Router();
var auth = require('../../helpers/auth');
var Edition = require('../../data/entities/edition');
var User = require('../../data/user');

var React = require('react');
var EditForm = React.createFactory(require('../../../client/components/forms/edition.jsx'));

/* Middleware loader functions. */
var makeEntityLoader = require('../../helpers/middleware').makeEntityLoader;

var loadEditionStatuses = require('../../helpers/middleware').loadEditionStatuses;
var loadLanguages = require('../../helpers/middleware').loadLanguages;
var loadEntityRelationships = require('../../helpers/middleware').loadEntityRelationships;
var loadIdentifierTypes = require('../../helpers/middleware').loadIdentifierTypes;

var bbws = require('../../helpers/bbws');
var Promise = require('bluebird');

/* If the route specifies a BBID, load the Edition for it. */
router.param('bbid', makeEntityLoader(Edition, 'Edition not found'));

router.get('/:bbid', loadEntityRelationships, function(req, res, next) {
	var edition = res.locals.entity;
	var title = 'Edition';

	if (edition.default_alias && edition.default_alias.name)
		title = 'Edition “' + edition.default_alias.name + '”';

	res.render('entity/view/edition', {
		title: title
	});
});

router.get('/:bbid/revisions', function(req, res, next) {
	var edition = res.locals.entity;
	var title = 'Edition';

	if (edition.default_alias && edition.default_alias.name)
		title = 'Edition “' + edition.default_alias.name + '”';

	bbws.get('/edition/' + edition.bbid + '/revisions')
	.then(function(revisions) {

		var users = {};
		revisions.objects.forEach(function(revision) {
			if(!users[revision.user.user_id]) {
				users[revision.user.user_id] = User.findOne(revision.user.user_id);
			}
		})

		Promise.props(users).then(function(users) {
			res.render('entity/revisions', {
				title: title,
				revisions: revisions,
				users: users
			});
		})
	});
});

// Creation

router.get('/create', auth.isAuthenticated, loadIdentifierTypes, loadEditionStatuses, loadLanguages, function(req, res) {
	var props = {
		languages: res.locals.languages,
		editionStatuses: res.locals.editionStatuses,
		identifierTypes: res.locals.identifierTypes,
		submissionUrl: '/edition/create/handler'
	};

	var markup = React.renderToString(EditForm(props));

	res.render('entity/create/edition', {
		title: 'Add Edition',
		heading: 'Create Edition',
		subheading: 'Add a new Edition to BookBrainz',
		props: props,
		markup: markup
	});
});

router.get('/:bbid/edit', auth.isAuthenticated, loadIdentifierTypes, loadEditionStatuses, loadLanguages, function(req, res) {
	var edition = res.locals.entity;

	var props = {
		languages: res.locals.languages,
		editionStatuses: res.locals.editionStatuses,
		identifierTypes: res.locals.identifierTypes,
		edition: edition,
		submissionUrl: '/edition/' + edition.bbid + '/edit/handler'
	};

	var markup = React.renderToString(EditForm(props));

	res.render('entity/create/edition', {
		title: 'Edit Edition',
		heading: 'Edit Edition',
		subheading: 'Edit an existing Edition in BookBrainz',
		props: props,
		markup: markup
	});
});

router.post('/create/handler', auth.isAuthenticated, function(req, res) {
	var changes = {
		bbid: null
	};

	if (req.body.editionStatusId) {
		changes.edition_status = {
			edition_status_id: req.body.editionStatusId
		};
	}

	if (req.body.languageId) {
		changes.language = {
			language_id: req.body.languageId
		};
	}

	if (req.body.releaseDate) {
		changes.release_date = req.body.releaseDate;
	}

	if (req.body.disambiguation)
		changes.disambiguation = req.body.disambiguation;

	if (req.body.annotation)
		changes.annotation = req.body.annotation;

	if (req.body.note) {
		changes.revision = {
			note: req.body.note
		};
	}

	var newIdentifiers = req.body.identifiers.map(function(identifier) {
		return {
			value: identifier.value,
			identifier_type: {
				identifier_type_id: identifier.typeId,
			}
		};
	});

	if (newIdentifiers.length) {
		changes.identifiers = newIdentifiers;
	}

	var newAliases = req.body.aliases.map(function(alias) {
		return {
			name: alias.name,
			sort_name: alias.sortName,
			language_id: alias.languageId,
			primary: alias.primary,
			default: alias.dflt
		};
	});

	if (newAliases.length) {
		changes.aliases = newAliases;
	}

	Edition.create(changes, {
			session: req.session
		})
		.then(function(revision) {
			res.send(revision);
		});
});

router.post('/:bbid/edit/handler', auth.isAuthenticated, function(req, res) {
	var edition = res.locals.entity;

	var changes = {
		bbid: edition.bbid
	};

	var editionStatusId = req.body.editionStatusId;
	if ((!edition.edition_status) ||
	    (edition.edition_status.edition_status_id !== editionStatusId)) {
		changes.edition_status = {
			edition_status_id: editionStatusId
		};
	}

	var languageId = req.body.languageId;
	if ((!edition.language) || (edition.language.language_id !== languageId)) {
		changes.language = {
			language_id: languageId
		};
	}

	var releaseDate = req.body.releaseDate;
	if (edition.release_date !== releaseDate) {
		changes.release_date = releaseDate ? releaseDate : null;
	}

	var disambiguation = req.body.disambiguation;
	if ((!edition.disambiguation) ||
	    (edition.disambiguation.comment !== disambiguation)) {
		changes.disambiguation = disambiguation ? disambiguation : null;
	}

	var annotation = req.body.annotation;
	if ((!edition.annotation) ||
			(edition.annotation.content !== annotation)) {
		changes.annotation = annotation ? annotation : null;
	}

	if (req.body.note) {
		changes.revision = {
			note: req.body.note
		};
	}

	var currentIdentifiers = edition.identifiers.map(function(identifier) {
		var nextIdentifier = req.body.identifiers[0];

		if (identifier.id != nextIdentifier.id) {
			// Remove the alias
			return [identifier.id, null];
		}
		else {
			// Modify the alias
			req.body.identifiers.shift();
			return [nextIdentifier.id, {
				value: nextIdentifier.value,
				identifier_type: {
					identifier_type_id: nextIdentifier.typeId,
				}
			}];
		}
	});

	var newIdentifiers = req.body.identifiers.map(function(identifier) {
		// At this point, the only aliases should have null IDs, but check anyway.
		if (identifier.id) {
			return null;
		}
		else {
			return [null, {
				value: identifier.value,
				identifier_type: {
					identifier_type_id: identifier.typeId,
				}
			}];
		}
	});

	changes.identifiers = currentIdentifiers.concat(newIdentifiers);

	var currentAliases = edition.aliases.map(function(alias) {
		var nextAlias = req.body.aliases[0];

		if (alias.id != nextAlias.id) {
			// Remove the alias
			return [alias.id, null];
		}
		else {
			// Modify the alias
			req.body.aliases.shift();
			return [nextAlias.id, {
				name: nextAlias.name,
				sort_name: nextAlias.sort_name,
				language_id: nextAlias.languageId,
				primary: alias.primary,
				default: alias.default
			}];
		}
	});

	var newAliases = req.body.aliases.map(function(alias) {
		// At this point, the only aliases should have null IDs, but check anyway.
		if (alias.id) {
			return null;
		}
		else {
			return [null, {
				name: alias.name,
				sort_name: alias.sort_name,
				language_id: alias.languageId,
				primary: false,
				default: false
			}];
		}
	});

	changes.aliases = currentAliases.concat(newAliases);
	if (changes.aliases.length !== 0 && changes.aliases[0][1]) {
		changes.aliases[0][1].default = true;
	}

	Edition.update(edition.bbid, changes, {
		session: req.session
	})
		.then(function(revision) {
			res.send(revision);
		});
});

module.exports = router;