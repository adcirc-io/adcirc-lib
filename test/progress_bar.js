function progress_bar () {

    var _bar;

    var _color = d3.color( 'orangered' );
    var _height = 10;
    var _progress = 0;
    var _shadow = false;

    function _progress_bar ( selection ) {

        _bar = selection
            .style( 'margin', 0 )
            .style( 'padding', 0 )
            .style( 'transition', 'width 200ms');

        _progress_bar.color( _color );
        _progress_bar.height( _height );
        _progress_bar.progress( _progress );

    }

    _progress_bar.color = function ( _ ) {
        if ( !arguments.length ) return _color;
        _color = _;
        if ( _bar ) _bar.style( 'background-color', _color );
        return _progress_bar;
    };

    _progress_bar.height = function ( _ ) {
        if ( !arguments.length ) return _height;
        _height = _;
        if ( _bar ) {
            _bar.style( 'min-height', _height + 'px' );
            _progress_bar.shadow( _shadow );
        }
        return _progress_bar;
    };

    _progress_bar.progress = function ( _ ) {
        if ( !arguments.length ) return _progress;
        if ( _ >= 0 && _ <= 100 ) _progress = _;
        if ( _bar ) _bar.style( 'width', _progress + '%' );
        return _progress_bar;
    };

    _progress_bar.shadow = function ( _ ) {
        if ( !arguments.length ) _shadow = !_shadow;
        else _shadow = !!_;
        if ( _shadow && _bar ) {
            var vo = ( _height / 2 ) - 1;
            var sb = vo - 1;
            vo = vo < 0 ? 0 : vo;
            sb = sb < 1 ? 1 : sb;
            _bar.style( 'box-shadow', '0 ' + vo + 'px ' + sb + 'px -' + sb + 'px black' );
        }
        return _progress_bar;
    };

    return _progress_bar;

}