% Mousseron: logical relations between Grambank v1.0.3 features.
%
% A profile (a real language or a generated mash-up) is evaluated as facts
%   v(Feature, Value).   e.g. v(gb020, 1).
% Unknown values ('?') are simply absent, so a rule only fires when every
% value it depends on is known. Profiles are loaded in batches via profile/2.
%
% constraint(Id, Kind, If, Then, Description)
%   If:   list of Feature=Value conditions that must all hold.
%   Then: any(Fs)         at least one of Fs is 1
%         none(Fs)        all of Fs are 0
%         at_most_one(Fs) no more than one of Fs is 1
%   Kind: definitional  the Grambank coding manual makes a violation a contradiction
%         exhaustive    the features jointly cover every logical possibility
%         proxy         a contradiction unless the system is of a kind no feature covers
%         universal     a typological tendency; violations are rare but legitimate

:- use_module(library(lists)).
:- dynamic(v/2).

% --- Articles (GB020-GB023, GB172, GB186) ---
constraint(prenominal_article_is_article, definitional, [gb022=1], any([gb020, gb021]),
  'Prenominal articles (GB022) must be definite (GB020) or indefinite (GB021) articles').
constraint(postnominal_article_is_article, definitional, [gb023=1], any([gb020, gb021]),
  'Postnominal articles (GB023) must be definite (GB020) or indefinite (GB021) articles').
constraint(definite_article_has_position, definitional, [gb020=1], any([gb022, gb023]),
  'A definite article (GB020) precedes (GB022) or follows (GB023) the noun').
constraint(indefinite_article_has_position, definitional, [gb021=1], any([gb022, gb023]),
  'An indefinite article (GB021) precedes (GB022) or follows (GB023) the noun').
constraint(article_gender_agreement_needs_article, definitional, [gb172=1], any([gb020, gb021]),
  'Article gender agreement (GB172) requires an article (GB020/GB021)').
constraint(article_number_agreement_needs_article, definitional, [gb186=1], any([gb020, gb021]),
  'Article number agreement (GB186) requires an article (GB020/GB021)').

% --- Attributive property words (GB193 value 0) ---
constraint(no_attributive_property_words, definitional, [gb193=0], none([gb026, gb170, gb184]),
  'If property words cannot be used attributively (GB193=0), they cannot be discontinuous (GB026) or agree (GB170, GB184)').

% --- Exhaustive option sets ---
constraint(flagging_alignment_exhaustive, exhaustive, [], any([gb408, gb409, gb410]),
  'Flagging is accusative (GB408), ergative (GB409) or neutral (GB410); no flagging at all is neutral').
constraint(standard_negation_exhaustive, exhaustive, [], any([gb107, gb298, gb299]),
  'Standard negation is bound (GB107), an inflecting word (GB298) or a non-inflecting word (GB299)').
constraint(transitive_order_exhaustive, exhaustive, [], any([gb131, gb132, gb133]),
  'The verb of a transitive clause is initial (GB131), medial (GB132) or final (GB133)').

% --- Gender/noun class: agreement presupposes an assignment basis (GB051-054, GB192, GB321) ---
constraint(property_word_gender_needs_gender, proxy, [gb170=1], any([gb051, gb052, gb053, gb054, gb192, gb321]),
  'Property-word gender agreement (GB170) presupposes a gender system').
constraint(demonstrative_gender_needs_gender, proxy, [gb171=1], any([gb051, gb052, gb053, gb054, gb192, gb321]),
  'Demonstrative gender agreement (GB171) presupposes a gender system').
constraint(article_gender_needs_gender, proxy, [gb172=1], any([gb051, gb052, gb053, gb054, gb192, gb321]),
  'Article gender agreement (GB172) presupposes a gender system').
constraint(numeral_gender_needs_gender, proxy, [gb198=1], any([gb051, gb052, gb053, gb054, gb192, gb321]),
  'Numeral gender agreement (GB198) presupposes a gender system').
constraint(augmentative_shift_needs_gender, proxy, [gb314=1], any([gb051, gb052, gb053, gb054, gb192, gb321]),
  'Augmentative by gender shift (GB314) presupposes a gender system').
constraint(diminutive_shift_needs_gender, proxy, [gb315=1], any([gb051, gb052, gb053, gb054, gb192, gb321]),
  'Diminutive by gender shift (GB315) presupposes a gender system').

% --- Other presuppositions ---
constraint(passive_agent_needs_passive, proxy, [gb304=1], any([gb147, gb302]),
  'An agent in a passive (GB304) presupposes a passive; word-order-only passives are not covered by GB147/GB302').
constraint(tense_distance_needs_tense, proxy, [gb309=1], any([gb082, gb083, gb084, gb110, gb121, gb521]),
  'Multiple past/future tenses (GB309) presuppose tense marking').
constraint(fixed_order_single_position, proxy, [gb136=1], at_most_one([gb131, gb132, gb133]),
  'Fixed constituent order (GB136) with more than one unmarked verb position (GB131-133)').

% --- Typological universals ---
constraint(dual_implies_plural, universal, [gb043=1], any([gb044]),
  'Dual marking on nouns (GB043) implies plural marking (GB044)').
constraint(trial_implies_dual, universal, [gb165=1], any([gb043]),
  'Trial marking on nouns (GB165) implies dual marking (GB043)').
constraint(free_dual_implies_free_plural, universal, [gb317=1], any([gb318]),
  'A free dual marker (GB317) implies a free plural marker (GB318)').
constraint(free_trial_implies_free_dual, universal, [gb319=1], any([gb317]),
  'A free trial marker (GB319) implies a free dual marker (GB317)').
constraint(first_person_gender_implies_other, universal, [gb197=1], any([gb196, gb030]),
  'Gender in 1st person pronouns (GB197) implies gender in 2nd or 3rd person (GB196/GB030)').
constraint(core_case_implies_alignment, universal, [gb070=1], any([gb408, gb409]),
  'Core case on nouns (GB070) implies accusative or ergative flagging (GB408/GB409)').

% --- Evaluation ---
holds([]).
holds([F=V|Rest]) :- v(F, V), holds(Rest).

violated(any(Fs)) :- forall(member(F, Fs), v(F, 0)).
violated(none(Fs)) :- member(F, Fs), v(F, 1), !.
violated(at_most_one(Fs)) :- select(A, Fs, Rest), v(A, 1), member(B, Rest), v(B, 1), !.

satisfied(any(Fs)) :- member(F, Fs), v(F, 1), !.
satisfied(none(Fs)) :- forall(member(F, Fs), v(F, 0)).
satisfied(at_most_one(Fs)) :- \+ violated(at_most_one(Fs)), forall(member(F, Fs), (v(F, 0) ; v(F, 1))).

% status(Id, Kind, Status): Status is violated, satisfied or undetermined.
% Rules whose If does not hold are not applicable and yield no status.
status(Id, Kind, Status) :-
  constraint(Id, Kind, If, Then, _),
  holds(If),
  (   violated(Then) -> Status = violated
  ;   satisfied(Then) -> Status = satisfied
  ;   Status = undetermined
  ).

% --- Batch evaluation ---
% profile(P, Values): Values is a list of Feature-Value pairs for profile P.
% check(P, Id, Status) evaluates every profile in turn.
:- dynamic(profile/2).

check(P, Id, Status) :-
  profile(P, Values),
  retractall(v(_, _)),
  forall(member(F-V, Values), assertz(v(F, V))),
  status(Id, _, Status).

% --- Rule-set sanity checks against feature/2 and code/2 facts ---
% feature(Id). code(Feature, Value).
rule_feature(Id, F) :- constraint(Id, _, If, _, _), member(F=_, If).
rule_feature(Id, F) :- constraint(Id, _, _, Then, _), Then =.. [_, Fs], member(F, Fs).

bad_rule(Id, unknown_feature(F)) :- rule_feature(Id, F), \+ feature(F).
bad_rule(Id, unknown_value(F, V)) :- constraint(Id, _, If, _, _), member(F=V, If), feature(F), \+ code(F, V).
bad_rule(Id, not_binary(F)) :- constraint(Id, _, _, Then, _), Then =.. [_, Fs], member(F, Fs), feature(F), \+ code(F, 1).
bad_rule(Id, bad_kind(K)) :- constraint(Id, K, _, _, _), \+ member(K, [definitional, exhaustive, proxy, universal]).
bad_rule(Id, duplicate_id) :- constraint(Id, _, _, _, _), findall(x, constraint(Id, _, _, _, _), [_, _|_]).
